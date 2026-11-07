import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { z } from "zod";
import { DibaMcpEngine } from "../../src/core/engine.ts";
import { CallLogger } from "../../src/core/logger.ts";
import { defineTool, ProviderError, type ProviderDef } from "../../src/core/types.ts";

let sent = 0;
const fake: ProviderDef = {
  id: "fake",
  name: "Fake",
  nameFa: "آزمایشی",
  category: "messenger",
  color: "#000",
  glyph: "آ",
  description: "",
  fields: [{ key: "token", label: "توکن", type: "secret", required: true }],
  tools: [
    defineTool({
      name: "fake_send",
      title: "ارسال",
      description: "send",
      input: { text: z.string().min(1) },
      handler: async (a, ctx) => {
        if (a.text === "boom") throw new ProviderError(`upstream rejected token ${ctx.config.token}`);
        if (a.text === "crash") throw new Error("unexpected");
        sent++;
        return { echoed: a.text };
      },
    }),
    defineTool({
      name: "fake_read",
      title: "خواندن",
      description: "read",
      input: {},
      annotations: { readOnlyHint: true },
      handler: async () => ({ ok: true }),
    }),
  ],
};

function engine(env: Record<string, string> = {}) {
  const e = new DibaMcpEngine({ dataDir: mkdtempSync(join(tmpdir(), "diba-eng-")), providers: [fake], env });
  e.store.update("fake", { enabled: true, values: { token: "TOPSECRET-TOKEN" } });
  return e;
}

describe("engine.callTool", () => {
  test("disabled provider and missing config are reported, not thrown", async () => {
    const e = engine();
    e.store.update("fake", { enabled: false });
    assert.match((await e.callTool("fake_send", { text: "x" }, "dashboard")).error!, /غیرفعال/);
    e.store.update("fake", { enabled: true, values: { token: "" } });
    assert.match((await e.callTool("fake_send", { text: "x" }, "dashboard")).error!, /کامل نیست/);
  });

  test("unknown tool and invalid input", async () => {
    const e = engine();
    assert.match((await e.callTool("nope", {}, "mcp")).error!, /وجود ندارد/);
    const bad = await e.callTool("fake_send", { text: "" }, "mcp");
    assert.equal(bad.ok, false);
    assert.match(bad.error!, /ورودی نامعتبر/);
  });

  test("provider errors are redacted; unexpected errors are wrapped", async () => {
    const e = engine();
    const r = await e.callTool("fake_send", { text: "boom" }, "dashboard");
    assert.ok(!r.error!.includes("TOPSECRET-TOKEN"));
    assert.match((await e.callTool("fake_send", { text: "crash" }, "dashboard")).error!, /خطای داخلی/);
  });

  test("write rate limit applies to model calls only, never to read-only tools or the dashboard", async () => {
    const e = engine({ MCP_WRITE_LIMIT: "2" });
    sent = 0;
    const r = [];
    for (let i = 0; i < 3; i++) r.push((await e.callTool("fake_send", { text: "hi" }, "mcp")).ok);
    assert.deepEqual(r, [true, true, false]);
    assert.match((await e.callTool("fake_send", { text: "hi" }, "mcp")).error!, /محدودیت ارسال/);
    assert.equal((await e.callTool("fake_read", {}, "mcp")).ok, true);
    assert.equal((await e.callTool("fake_send", { text: "hi" }, "dashboard")).ok, true);
    assert.equal(sent, 3);
  });

  test("every call is logged, including failures", async () => {
    const e = engine();
    await e.callTool("fake_send", { text: "a" }, "mcp");
    await e.callTool("fake_send", { text: "" }, "mcp");
    const logs = e.logger.list();
    assert.equal(logs.length, 2);
    assert.deepEqual(logs.map((l) => l.ok), [false, true]);
  });
});

describe("CallLogger persistence", () => {
  test("logs survive a restart (new instance reads the files)", () => {
    const d = mkdtempSync(join(tmpdir(), "diba-log-"));
    const a = new CallLogger({ dir: d });
    a.add({ tool: "t1", provider: "p", source: "mcp", ok: true, ms: 1, args: {} });
    a.add({ tool: "t2", provider: "p", source: "mcp", ok: false, ms: 2, args: {}, error: "x" });
    const b = new CallLogger({ dir: d });
    assert.deepEqual(b.list().map((l) => l.tool), ["t2", "t1"]);
  });

  test("old files are pruned, corrupt lines skipped, clear removes files", () => {
    const d = mkdtempSync(join(tmpdir(), "diba-log-"));
    writeFileSync(join(d, "calls-2020-01-01.jsonl"), "{}\n");
    const today = new Date().toISOString().slice(0, 10);
    writeFileSync(join(d, `calls-${today}.jsonl`), `not json\n${JSON.stringify({ id: "1", time: new Date().toISOString(), tool: "ok" })}\n`);
    const l = new CallLogger({ dir: d, retentionDays: 7 });
    assert.ok(!readdirSync(d).includes("calls-2020-01-01.jsonl"));
    assert.deepEqual(l.list().map((x) => x.tool), ["ok"]);
    l.clear();
    assert.equal(readdirSync(d).length, 0);
    assert.equal(l.list().length, 0);
  });

  test("respects the in-memory max", () => {
    const l = new CallLogger({ max: 3 });
    for (let i = 0; i < 5; i++) l.add({ tool: `t${i}`, provider: "p", source: "mcp", ok: true, ms: 0, args: {} });
    assert.deepEqual(l.list().map((x) => x.tool), ["t4", "t3", "t2"]);
  });
});
