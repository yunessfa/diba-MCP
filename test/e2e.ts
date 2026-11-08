/**
 * تست سرتاسری: یک سرور جعلی به‌جای API پیام‌رسان‌ها بالا می‌آورد،
 * سرور diba-mcp را اجرا می‌کند و با کلاینت واقعی MCP ابزارها را صدا می‌زند.
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
import { createDibaMcp } from "../src/index.js";
import { runSelfTest } from "../src/core/selftest.js";

const listen = (app: express.Express) =>
  new Promise<{ url: string; close: () => void }>((ok) => {
    const s = app.listen(0, "127.0.0.1", () => ok({ url: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, close: () => s.close() }));
  });

// ---------- API جعلی ----------
const seen: any[] = [];
const tgUpdates: any[] = [];
const tgUpdate = (id: number, chat: number, text: string, extra: Record<string, unknown> = {}) =>
  tgUpdates.push({ update_id: id, message: { message_id: id, date: Math.floor(Date.now() / 1000), text, chat: { id: chat, type: "private", first_name: "مریم", ...extra }, from: { id: chat, first_name: "مریم" } } });
const mock = express();

/** multipart را به { field: value | {name,type,size,bytes} } تبدیل می‌کند */
async function readForm(req: express.Request) {
  const form = await new Request("http://x", { method: "POST", headers: req.headers as any, body: req as any, duplex: "half" } as any).formData();
  const out: Record<string, any> = {};
  for (const [k, v] of form as any) {
    out[k] = typeof v === "string" ? v : { name: v.name, type: v.type, size: v.size, bytes: Buffer.from(await v.arrayBuffer()) };
  }
  return out;
}
const isMultipart = (req: express.Request) => String(req.headers["content-type"] ?? "").startsWith("multipart/");

// یک PNG کوچک واقعی (۱×۱)
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
mock.get("/img/cat", (_req, res) => void res.type("image/png").send(PNG));
mock.get("/go", (_req, res) => void res.redirect(302, "/img/cat"));
mock.get("/doc.txt", (_req, res) => void res.type("text/plain").send("hello file"));

mock.post("/tg/:bot/:method", express.json(), async (req, res) => {
  const body = isMultipart(req) ? await readForm(req) : req.body;
  seen.push({ api: "tg", bot: req.params.bot, method: req.params.method, body });
  if (req.params.bot !== "botGOOD:TOKEN") return void res.status(401).json({ ok: false, description: "Unauthorized" });
  if (req.params.method === "getMe") return void res.json({ ok: true, result: { id: 1, username: "test_bot", first_name: "ربات تست" } });
  if (req.params.method === "getUpdates") {
    const offset = Number(body.offset ?? 0);
    return void res.json({ ok: true, result: tgUpdates.filter((u) => u.update_id >= offset) });
  }
  if (req.params.method === "getChat") return void res.json({ ok: true, result: { id: body.chat_id, type: "private", first_name: "مریم" } });
  res.json({ ok: true, result: { message_id: 42, chat: { id: body.chat_id }, text: body.text } });
});
mock.post("/eitaa/:token/:method", async (req, res) => {
  seen.push({ api: "eitaa", method: req.params.method, body: await readForm(req) });
  res.json({ ok: true, result: { message_id: 7 } });
});
mock.post("/rubika-upload/:slot", async (req, res) => {
  const body = await readForm(req);
  seen.push({ api: "rubika-upload", slot: req.params.slot, body });
  res.json({ status: "OK", data: { file_id: `F-${body.file?.size}` } });
});
mock.post("/rubika/:token/:method", express.json(), (req, res) => {
  seen.push({ api: "rubika", method: req.params.method, body: req.body });
  if (req.params.method === "sendMessage") return void res.json({ status: "OK", data: { message_id: "999" } });
  if (req.params.method === "requestSendFile")
    return void res.json({ status: "OK", data: { upload_url: `http://${req.headers.host}/rubika-upload/${req.body.type}` } });
  if (req.params.method === "sendFile") return void res.json({ status: "OK", data: { message_id: "1001" } });
  res.json({ status: "INVALID_INPUT", dev_message: "bad chat" });
});
const upstream = await listen(mock);

// ---------- diba-mcp ----------
const dataDir = mkdtempSync(join(tmpdir(), "diba-mcp-test-"));
// mock روی 127.0.0.1 است، پس دانلود از آدرس داخلی فقط در تست مجاز می‌شود
const dibaMcp = createDibaMcp({ dataDir, env: { ALLOW_PRIVATE_MEDIA_URLS: "true" } });
const { store } = dibaMcp.engine;
store.update("bale", { enabled: true, values: { token: "GOOD:TOKEN", baseUrl: `${upstream.url}/tg`, defaultChatId: "555" } });
store.update("soroush", { enabled: true, values: { token: "BAD", baseUrl: `${upstream.url}/tg` } });
store.update("eitaa", { enabled: true, values: { token: "e-tok", baseUrl: `${upstream.url}/eitaa`, defaultChatId: "mychannel" } });
store.update("rubika", { enabled: true, values: { token: "r-tok", baseUrl: `${upstream.url}/rubika` } });

const app = express();
app.use("/diba-mcp", dibaMcp.router()); // مثل الحاق به پروژه‌ی میزبان، با پیشوند
const srv = await listen(app);
const mcpUrl = new URL(`${srv.url}/diba-mcp/mcp`);

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

  const DATA_URL = `data:image/png;name=${encodeURIComponent("عکس من.png")};base64,${PNG.toString("base64")}`;
  const call = async (name: string, args: Record<string, unknown>) => {
    const r: any = await client.callTool({ name, arguments: args });
    assert.ok(!r.isError, `${name}: ${r.content?.[0]?.text}`);
    return r;
  };

  await step("بله: عکس از لینک ← سرور دانلود و multipart آپلود می‌کند", async () => {
    await call("bale_send_photo", { photo: `${upstream.url}/go`, caption: "گربه" });
    const last = seen.at(-1);
    assert.equal(last.method, "sendPhoto");
    assert.equal(last.body.chat_id, "555");
    assert.equal(last.body.caption, "گربه");
    assert.equal(last.body.photo.type, "image/png");
    assert.equal(last.body.photo.name, "cat.png"); // پسوند از روی نوع فایل
    assert.ok(last.body.photo.bytes.equals(PNG));
  });

  await step("بله: عکس انتخاب‌شده از دستگاه (data URL) با نام فارسی", async () => {
    await call("bale_send_photo", { photo: DATA_URL });
    const last = seen.at(-1);
    assert.equal(last.body.photo.name, "عکس من.png");
    assert.ok(last.body.photo.bytes.equals(PNG));
  });

  await step("بله: file_id بدون آپلود، به‌صورت JSON", async () => {
    await call("bale_send_photo", { photo: "AgACAgQAAxkBAAI" });
    assert.equal(seen.at(-1).body.photo, "AgACAgQAAxkBAAI");
  });

  await step("بله: ارسال فایل و جلوگیری از فرستادن غیرعکس به‌جای عکس", async () => {
    await call("bale_send_document", { document: `${upstream.url}/doc.txt`, filename: "گزارش" });
    const last = seen.at(-1);
    assert.equal(last.method, "sendDocument");
    assert.equal(last.body.document.name, "گزارش.txt");
    const bad: any = await client.callTool({ name: "bale_send_photo", arguments: { photo: `${upstream.url}/doc.txt` } });
    assert.equal(bad.isError, true);
    assert.match(bad.content[0].text, /عکس نیست/);
  });

  await step("روبیکا: requestSendFile ← آپلود ← sendFile", async () => {
    const r = await call("rubika_send_photo", { chat_id: "b0X", photo: DATA_URL, caption: "سلام" });
    const steps = seen.slice(-3);
    assert.deepEqual(steps.map((x) => x.method ?? x.api), ["requestSendFile", "rubika-upload", "sendFile"]);
    assert.equal(steps[0].body.type, "Image");
    assert.equal(steps[1].body.file.size, PNG.length);
    assert.deepEqual(steps[2].body, { chat_id: "b0X", file_id: `F-${PNG.length}`, text: "سلام" });
    assert.match(r.content[0].text, /1001/);
    await call("rubika_send_file", { chat_id: "b0X", file: `${upstream.url}/doc.txt`, type: "File" });
    assert.equal(seen.at(-3).body.type, "File");
  });

  await step("ایتا: عکس و فایل با فیلد file؛ file_id رد می‌شود", async () => {
    await call("eitaa_send_photo", { photo: DATA_URL, caption: "پست" });
    const last = seen.at(-1);
    assert.equal(last.method, "sendFile");
    assert.equal(last.body.chat_id, "mychannel");
    assert.equal(last.body.file.name, "عکس من.png");
    const bad: any = await client.callTool({ name: "eitaa_send_file", arguments: { file: "some_file_id" } });
    assert.equal(bad.isError, true);
  });

  await step("لاگ‌ها data URL کامل را ذخیره نمی‌کنند", async () => {
    const big = `data:text/plain;name=big.txt;base64,${Buffer.alloc(50_000, 65).toString("base64")}`;
    await call("eitaa_send_file", { file: big });
    assert.equal(seen.at(-1).body.file.size, 50_000);
    const log = dibaMcp.engine.logger.list().find((l) => l.tool === "eitaa_send_file")!;
    const logged = String((log.args as any).file);
    assert.match(logged, /\(49 KB\)$/);
    assert.ok(logged.length < 200);
  });

  await step("دریافت پیام: get_updates مستقیم وقتی دریافت خاموش است", async () => {
    tgUpdate(100, 777, "سلام ربات");
    const r = await call("bale_get_updates", {});
    const data = JSON.parse(r.content[0].text);
    assert.equal(data.source, "api");
    assert.equal(data.messages[0].chatId, "777");
    assert.equal(data.messages[0].chatTitle, "مریم");
  });

  await step("دریافت پیام: حلقه‌ی دریافت، صندوق، list_chats و offset", async () => {
    dibaMcp.engine.inbox.idleMs = 20;
    dibaMcp.engine.updateProvider("bale", { receive: true });
    const until = async (cond: () => boolean) => {
      for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 15));
      assert.ok(cond(), "timeout");
    };
    await until(() => dibaMcp.engine.inbox.messages("bale").length === 1);
    tgUpdate(101, 888, "پیام دوم", { first_name: "رضا" });
    await until(() => dibaMcp.engine.inbox.messages("bale").length === 2);
    // offset درست جلو رفته: آخرین getUpdates با offset=102
    const lastPoll = seen.filter((x) => x.method === "getUpdates").at(-1);
    assert.equal(lastPoll.body.offset, 102);
    const r = await call("bale_get_updates", { chat_id: "888" });
    const data = JSON.parse(r.content[0].text);
    assert.equal(data.source, "inbox");
    assert.deepEqual(data.messages.map((m: any) => m.text), ["پیام دوم"]);
    const chats = JSON.parse((await call("list_chats", { provider: "bale" })).content[0].text);
    assert.deepEqual(chats.chats.map((c: any) => c.chatId).sort(), ["777", "888"]);
  });

  await step("تست کامل بله: همه‌ی قدم‌ها سبز", async () => {
    const r = await runSelfTest(dibaMcp.engine, "bale", { send: true });
    const by = Object.fromEntries(r.steps.map((s) => [s.id, s.status]));
    assert.deepEqual(by, { config: "ok", network: "ok", auth: "ok", chat: "ok", send_text: "ok", send_photo: "ok", receive: "ok" }, r.text);
    assert.equal(r.ok, true);
    assert.match(r.text, /✅ ارسال عکس/);
    const photo = seen.filter((x) => x.method === "sendPhoto").at(-1);
    assert.equal(photo.body.photo.type, "image/png");
    assert.ok(!r.text.includes("GOOD:TOKEN"));
  });

  await step("تست کامل سروش با توکن اشتباه: خطا + راهنما + بقیه رد می‌شوند", async () => {
    const r = await runSelfTest(dibaMcp.engine, "soroush", { send: true });
    const auth = r.steps.find((s) => s.id === "auth")!;
    assert.equal(auth.status, "fail");
    assert.match(auth.hint!, /توکن/);
    assert.ok(r.steps.filter((s) => ["chat", "send_text", "send_photo", "receive"].includes(s.id)).every((s) => s.status === "skip"));
    assert.equal(r.ok, false);
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
    const logs = dibaMcp.engine.logger.list();
    assert.ok(logs.length >= 5);
    assert.ok(logs.every((l) => !JSON.stringify(l).includes("GOOD:TOKEN")));
  });

  await step("داشبورد: بدون ورود ← 401، صفحه در دسترس", async () => {
    const r = await fetch(`${srv.url}/diba-mcp/api/providers`);
    assert.equal(r.status, 401);
    const page = await fetch(`${srv.url}/diba-mcp/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<html/);
  });

  await client.close();
  dibaMcp.engine.inbox.stop();
  console.log(`\n  همه‌ی ${passed} تست با موفقیت گذشت ✅`);
} finally {
  srv.close();
  upstream.close();
  rmSync(dataDir, { recursive: true, force: true });
}
process.exit(0);
