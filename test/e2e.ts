/**
 * تست سرتاسری: یک سرور جعلی به‌جای API پیام‌رسان‌ها بالا می‌آورد،
 * سرور iran-mcp را اجرا می‌کند و با کلاینت واقعی MCP ابزارها را صدا می‌زند.
 *   npm test
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createIranMcp } from "../src/index.js";

const listen = (app: express.Express) =>
  new Promise<{ url: string; close: () => void }>((ok) => {
    const s = app.listen(0, "127.0.0.1", () => ok({ url: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, close: () => s.close() }));
  });

// ---------- API جعلی ----------
const seen: any[] = [];
const mock = express();
mock.post("/tg/:bot/:method", express.json(), (req, res) => {
  seen.push({ api: "tg", bot: req.params.bot, method: req.params.method, body: req.body });
  if (req.params.bot !== "botGOOD:TOKEN") return void res.status(401).json({ ok: false, description: "Unauthorized" });
  if (req.params.method === "getMe") return void res.json({ ok: true, result: { id: 1, username: "test_bot" } });
  res.json({ ok: true, result: { message_id: 42, chat: { id: req.body.chat_id }, text: req.body.text } });
});
mock.post("/eitaa/:token/:method", async (req, res) => {
  const form = await new Request("http://x", { method: "POST", headers: req.headers as any, body: req as any, duplex: "half" } as any).formData();
  seen.push({ api: "eitaa", method: req.params.method, body: Object.fromEntries(form) });
  res.json({ ok: true, result: { message_id: 7 } });
});
mock.post("/rubika/:token/:method", express.json(), (req, res) => {
  seen.push({ api: "rubika", method: req.params.method, body: req.body });
  if (req.params.method === "sendMessage") return void res.json({ status: "OK", data: { message_id: "999" } });
  res.json({ status: "INVALID_INPUT", dev_message: "bad chat" });
});
const upstream = await listen(mock);

// ---------- iran-mcp ----------
const dataDir = mkdtempSync(join(tmpdir(), "iran-mcp-test-"));
const iranMcp = createIranMcp({ dataDir, env: {} });
const { store } = iranMcp.engine;
store.update("bale", { enabled: true, values: { token: "GOOD:TOKEN", baseUrl: `${upstream.url}/tg`, defaultChatId: "555" } });
store.update("soroush", { enabled: true, values: { token: "BAD", baseUrl: `${upstream.url}/tg` } });
store.update("eitaa", { enabled: true, values: { token: "e-tok", baseUrl: `${upstream.url}/eitaa`, defaultChatId: "mychannel" } });
store.update("rubika", { enabled: true, values: { token: "r-tok", baseUrl: `${upstream.url}/rubika` } });

const app = express();
app.use("/iran-mcp", iranMcp.router()); // مثل الحاق به پروژه‌ی میزبان، با پیشوند
const srv = await listen(app);
const mcpUrl = new URL(`${srv.url}/iran-mcp/mcp`);

let passed = 0;
const step = async (name: string, fn: () => Promise<void>) => {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

try {
  await step("بدون توکن ← 401", async () => {
    const r = await fetch(mcpUrl, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(r.status, 401);
  });

  const client = new Client({ name: "e2e", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(mcpUrl, { requestInit: { headers: { Authorization: `Bearer ${store.mcpToken}` } } }),
  );

  await step("فهرست ابزارها", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const n of ["list_services", "bale_send_message", "eitaa_send_message", "rubika_send_message", "soroush_get_me"])
      assert.ok(names.includes(n), `missing ${n}`);
    assert.equal(tools.find((t) => t.name === "bale_get_me")?.annotations?.readOnlyHint, true);
  });

  await step("بله: ارسال پیام با چت پیش‌فرض", async () => {
    const r: any = await client.callTool({ name: "bale_send_message", arguments: { text: "سلام از تست" } });
    assert.ok(!r.isError, r.content?.[0]?.text);
    const last = seen.at(-1);
    assert.equal(last.method, "sendMessage");
    assert.equal(last.body.chat_id, "555");
    assert.equal(last.body.text, "سلام از تست");
  });

  await step("سروش: توکن اشتباه ← خطای خوانا و بدون نشت توکن", async () => {
    const r: any = await client.callTool({ name: "soroush_get_me", arguments: {} });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /Unauthorized/);
  });

  await step("ایتا: form-data با pin", async () => {
    const r: any = await client.callTool({ name: "eitaa_send_message", arguments: { text: "خبر", pin: true } });
    assert.ok(!r.isError, r.content?.[0]?.text);
    const last = seen.at(-1);
    assert.equal(last.api, "eitaa");
    assert.equal(last.body.chat_id, "mychannel");
    assert.equal(last.body.pin, "1");
  });

  await step("روبیکا: موفق و خطای status", async () => {
    const ok: any = await client.callTool({ name: "rubika_send_message", arguments: { chat_id: "b0X", text: "hi" } });
    assert.ok(!ok.isError);
    assert.match(ok.content[0].text, /999/);
    const bad: any = await client.callTool({ name: "rubika_get_chat", arguments: { chat_id: "zz" } });
    assert.equal(bad.isError, true);
    assert.match(bad.content[0].text, /bad chat/);
  });

  await step("ورودی نامعتبر", async () => {
    const r: any = await client.callTool({ name: "bale_send_message", arguments: { text: "" } });
    assert.equal(r.isError, true);
  });

  await step("غیرفعال کردن سرویس ← ابزار حذف می‌شود", async () => {
    store.update("rubika", { enabled: false });
    const { tools } = await client.listTools();
    assert.ok(!tools.some((t) => t.name.startsWith("rubika_")));
  });

  await step("لاگ ثبت شده", async () => {
    const logs = iranMcp.engine.logger.list();
    assert.ok(logs.length >= 5);
    assert.ok(logs.every((l) => !JSON.stringify(l).includes("GOOD:TOKEN")));
  });

  await step("داشبورد: بدون ورود ← 401، صفحه در دسترس", async () => {
    const r = await fetch(`${srv.url}/iran-mcp/api/providers`);
    assert.equal(r.status, 401);
    const page = await fetch(`${srv.url}/iran-mcp/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<html/);
  });

  await client.close();
  console.log(`\n  همه‌ی ${passed} تست با موفقیت گذشت ✅`);
} finally {
  srv.close();
  upstream.close();
  rmSync(dataDir, { recursive: true, force: true });
}
process.exit(0);
