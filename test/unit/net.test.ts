import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { request } from "../../src/core/http.ts";
import { configureProxy, describeNetError, proxyMode } from "../../src/core/net.ts";
import { ProviderError } from "../../src/core/types.ts";

describe("configureProxy", () => {
  test("no proxy env → direct", () => {
    assert.deepEqual(configureProxy({}), { type: "direct" });
  });

  test("SOCKS_PROXY wins over HTTPS_PROXY and hides the password", () => {
    const m = configureProxy({ SOCKS_PROXY: "socks5://user:p%40ss@10.0.0.1:1080", HTTPS_PROXY: "http://x:1" });
    assert.equal(m.type, "socks5");
    assert.ok(!m.target!.includes("p%40ss"));
    assert.ok(m.target!.includes("***"));
  });

  test("IPv6 SOCKS address is accepted", () => {
    assert.equal(configureProxy({ SOCKS_PROXY: "socks5://[::1]:1080" }).type, "socks5");
  });

  test("HTTPS_PROXY → http mode", () => {
    assert.equal(configureProxy({ HTTPS_PROXY: "http://proxy:3128" }).type, "http");
    configureProxy({});
    assert.equal(proxyMode().type, "direct");
  });
});

describe("describeNetError", () => {
  test("proxy refusal deep in the cause chain", () => {
    const err = new TypeError("fetch failed", {
      cause: Object.assign(new Error("Request was cancelled.", { cause: new Error("Proxy response (403) !== 200 when HTTP Tunneling") }), { code: 0 }),
    });
    assert.equal(describeNetError(err), "پراکسی اتصال را رد کرد (HTTP 403)");
  });

  test("DNS failure", () => {
    const err = new TypeError("fetch failed", { cause: Object.assign(new Error("getaddrinfo ENOTFOUND x.invalid"), { code: "ENOTFOUND" }) });
    assert.match(describeNetError(err), /DNS/);
  });

  test("timeout", () => {
    const err = Object.assign(new Error("aborted"), { name: "TimeoutError" });
    assert.match(describeNetError(err), /محدودیت IP خارجی/);
  });
});

describe("request() failure paths", () => {
  let server: Server;
  let base = "";
  before(async () => {
    configureProxy({});
    server = createServer((req, res) => {
      if (req.url === "/hang") return; // هیچ‌وقت جواب نده
      if (req.url === "/html") {
        res.writeHead(502, { "content-type": "text/html" });
        return res.end("<html>Bad Gateway</html>");
      }
      if (req.url === "/leak") {
        res.writeHead(401, { "content-type": "application/json" });
        return res.end(JSON.stringify({ ok: false, description: "bad token SECRET-123-TOKEN" }));
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => server.closeAllConnections() || server.close());

  test("upstream that never answers → Persian timeout error", async () => {
    await assert.rejects(request(`${base}/hang`, { timeoutMs: 300 }), (e: any) => e instanceof ProviderError && /زمان پاسخ‌گویی/.test(e.message));
  });

  test("upstream down (connection refused)", async () => {
    await assert.rejects(request("http://127.0.0.1:1/x", { timeoutMs: 2000 }), (e: any) => e instanceof ProviderError && /اتصال/.test(e.message));
  });

  test("non-JSON error page keeps status and a snippet", async () => {
    await assert.rejects(request(`${base}/html`), (e: any) => /HTTP 502/.test(e.message) && /Bad Gateway/.test(e.message));
  });

  test("secrets are redacted from error messages", async () => {
    await assert.rejects(request(`${base}/leak`, { secrets: ["SECRET-123-TOKEN"] }), (e: any) => !e.message.includes("SECRET-123-TOKEN") && e.message.includes("***"));
  });

  test("happy path returns parsed JSON", async () => {
    assert.deepEqual(await request(`${base}/ok`, { json: {} }), { ok: true });
  });
});
