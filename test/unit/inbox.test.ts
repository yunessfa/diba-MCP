import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { DibaMcpEngine } from "../../src/core/engine.ts";
import { hintFor } from "../../src/core/selftest.ts";
import { testImagePng } from "../../src/core/testimage.ts";
import type { IncomingMessage, ProviderDef } from "../../src/core/types.ts";
import { normalizeRubikaUpdate } from "../../src/providers/rubika.ts";
import { normalizeTelegramUpdate } from "../../src/providers/telegram-like.ts";

describe("normalizeTelegramUpdate (Bale / Soroush)", () => {
  test("private text message", () => {
    const m = normalizeTelegramUpdate("bale", {
      update_id: 10,
      message: { message_id: 5, date: 1_700_000_000, text: "سلام", chat: { id: 123, type: "private", first_name: "علی", last_name: "رضایی" }, from: { id: 123, first_name: "علی", username: "ali" } },
    })!;
    assert.equal(m.key, "bale:123:5");
    assert.equal(m.chatId, "123");
    assert.equal(m.chatType, "private");
    assert.equal(m.chatTitle, "علی رضایی");
    assert.equal(m.from?.username, "ali");
    assert.equal(m.kind, "text");
    assert.equal(m.date, new Date(1_700_000_000_000).toISOString());
  });

  test("channel post with photo + caption, supergroup, button click", () => {
    const ch = normalizeTelegramUpdate("bale", { update_id: 1, channel_post: { message_id: 9, date: 1, caption: "عکس", photo: [{}], chat: { id: -100, type: "channel", title: "کانال من" } } })!;
    assert.equal(ch.chatType, "channel");
    assert.equal(ch.kind, "photo");
    assert.equal(ch.text, "عکس");
    assert.equal(ch.chatTitle, "کانال من");
    assert.equal(normalizeTelegramUpdate("bale", { message: { message_id: 1, chat: { id: -5, type: "supergroup", title: "g" }, text: "x" } })!.chatType, "group");
    const cb = normalizeTelegramUpdate("bale", { callback_query: { id: "77", data: "menu_1", from: { id: 3, first_name: "B" }, message: { message_id: 4, chat: { id: 3, type: "private" } } } })!;
    assert.equal(cb.kind, "button");
    assert.equal(cb.buttonId, "menu_1");
    assert.equal(cb.key, "bale:3:cb77");
  });

  test("garbage is ignored", () => {
    assert.equal(normalizeTelegramUpdate("bale", {}), null);
    assert.equal(normalizeTelegramUpdate("bale", null), null);
    assert.equal(normalizeTelegramUpdate("bale", { message: { text: "no chat" } }), null);
  });
});

describe("normalizeRubikaUpdate", () => {
  test("NewMessage text, file, button, StartedBot", () => {
    const t = normalizeRubikaUpdate({ type: "NewMessage", chat_id: "b0ABC", new_message: { message_id: "11", text: "hi", time: "1700000000", sender_id: "u0X" } })!;
    assert.equal(t.chatType, "private");
    assert.equal(t.key, "rubika:b0ABC:11");
    assert.equal(t.from?.id, "u0X");
    assert.equal(t.date, new Date(1_700_000_000_000).toISOString());
    assert.equal(normalizeRubikaUpdate({ chat_id: "g0G", new_message: { message_id: 1, file: { file_name: "a.JPG" } } })!.kind, "photo");
    assert.equal(normalizeRubikaUpdate({ chat_id: "c0C", new_message: { message_id: 2, file: { file_name: "a.pdf" } } })!.kind, "file");
    const b = normalizeRubikaUpdate({ inline_message: { chat_id: "b0Z", message_id: "3", text: "خرید", aux_data: { button_id: "buy" } } })!;
    assert.equal(b.kind, "button");
    assert.equal(b.buttonId, "buy");
    const s = normalizeRubikaUpdate({ type: "StartedBot", chat_id: "b0Q", time: "5" })!;
    assert.match(s.text!, /start/);
    assert.equal(normalizeRubikaUpdate({ type: "StoppedBot" }), null);
  });
});

// ---------------- صندوق با یک پیام‌رسان ساختگی ----------------
function fakeProvider(script: Array<IncomingMessage[] | Error>) {
  const calls: Array<string | undefined> = [];
  let i = 0;
  const p: ProviderDef = {
    id: "fake",
    name: "Fake",
    nameFa: "آزمایشی",
    category: "messenger",
    color: "#000",
    glyph: "آ",
    description: "",
    fields: [{ key: "token", label: "t", type: "secret", required: true }],
    tools: [],
    receive: {
      async poll(_ctx, cursor) {
        calls.push(cursor);
        const step = script[Math.min(i, script.length - 1)];
        i++;
        if (step instanceof Error) throw step;
        return { messages: step, cursor: String(i) };
      },
    },
  };
  return { p, calls };
}

const msg = (id: number, chat = "c1", title = "Chat 1"): IncomingMessage => ({
  key: `fake:${chat}:${id}`,
  provider: "fake",
  chatId: chat,
  chatTitle: title,
  chatType: "private",
  messageId: String(id),
  text: `m${id}`,
  kind: "text",
  date: new Date(1_700_000_000_000 + id * 1000).toISOString(),
});

const until = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe("Inbox", () => {
  test("fetchOnce stores, dedupes, advances cursor and persists across restarts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "diba-inbox-"));
    const { p, calls } = fakeProvider([[msg(1), msg(2)], [msg(2), msg(3, "c2", "Chat 2")]]);
    const e = new DibaMcpEngine({ dataDir: dir, providers: [p], env: {} });
    e.updateProvider("fake", { enabled: true, values: { token: "T" } });
    assert.equal((await e.inbox.fetchOnce("fake")).added, 2);
    assert.equal((await e.inbox.fetchOnce("fake")).added, 1); // msg(2) تکراری
    assert.deepEqual(calls, [undefined, "1"]);
    assert.deepEqual(e.inbox.messages("fake").map((m) => m.messageId), ["3", "2", "1"]);
    const chats = e.inbox.chats();
    assert.equal(chats.length, 2);
    assert.equal(chats.find((c) => c.chatId === "c1")!.count, 2);
    e.inbox.stop(); // flush

    const e2 = new DibaMcpEngine({ dataDir: dir, providers: [p], env: {} });
    assert.equal(e2.inbox.messages("fake", { chatId: "c1" }).length, 2);
  });

  test("background loop runs only while receive is on, records errors, then recovers", async () => {
    const dir = mkdtempSync(join(tmpdir(), "diba-inbox-"));
    const { p, calls } = fakeProvider([[msg(1)], new Error("Conflict: terminated by other getUpdates request"), [msg(2)], []]);
    const e = new DibaMcpEngine({ dataDir: dir, providers: [p], env: {} });
    e.inbox.idleMs = 5;
    e.updateProvider("fake", { enabled: true, values: { token: "T" } });
    e.inbox.start();
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(calls.length, 0, "receive is off → no polling");

    e.updateProvider("fake", { receive: true });
    await until(() => e.inbox.statuses()[0].lastError !== undefined);
    assert.match(e.inbox.statuses()[0].lastError!, /Conflict/);
    assert.equal(e.inbox.statuses()[0].running, true);
    await until(() => e.inbox.messages("fake").length === 2, 5000);
    assert.equal(e.inbox.statuses()[0].lastError, undefined);

    e.updateProvider("fake", { receive: false });
    const n = calls.length;
    await new Promise((r) => setTimeout(r, 60));
    assert.ok(calls.length <= n + 1, "loop stops after receive is turned off");
    assert.equal(e.inbox.statuses()[0].running, false);
    e.inbox.stop();
  });

  test("tools see the inbox only when receive is on; env flag wins", () => {
    const { p } = fakeProvider([[]]);
    const e = new DibaMcpEngine({ dataDir: mkdtempSync(join(tmpdir(), "diba-inbox-")), providers: [p], env: {} });
    e.updateProvider("fake", { enabled: true, values: { token: "T" } });
    assert.equal(e.contextOf(p).inbox, undefined);
    e.updateProvider("fake", { receive: true });
    assert.ok(e.contextOf(p).inbox);
    const e2 = new DibaMcpEngine({ dataDir: mkdtempSync(join(tmpdir(), "diba-inbox-")), providers: [p], env: { FAKE_RECEIVE: "true" } });
    assert.ok(e2.contextOf(p).inbox);
    assert.equal(e2.store.receiveFromEnv(p), true);
  });
});

describe("outgoing messages", () => {
  test("recorded with direction out; an incoming copy with the same id is not duplicated", () => {
    const { p } = fakeProvider([[]]);
    const e = new DibaMcpEngine({ dataDir: mkdtempSync(join(tmpdir(), "diba-out-")), providers: [p], env: {} });
    e.inbox.recordOutgoing("fake", { chatId: "c9", messageId: "42", text: "hi", kind: "text", source: "dashboard" });
    e.inbox.add("fake", [{ ...msg(42, "c9"), key: "fake:c9:42" }]);
    const list = e.inbox.messages("fake", { chatId: "c9" });
    assert.equal(list.length, 1);
    assert.equal(list[0].direction, "out");
    e.inbox.recordOutgoing("fake", { chatId: "c9", text: "no id", kind: "text", source: "mcp" });
    e.inbox.recordOutgoing("fake", { chatId: "c9", text: "no id 2", kind: "text", source: "mcp" });
    assert.equal(e.inbox.messages("fake", { chatId: "c9" }).length, 3, "messages without an id get unique local ids");
  });
});

describe("self-test helpers", () => {
  test("hints map common errors to advice", () => {
    assert.match(hintFor("بله: Unauthorized", "auth")!, /توکن/);
    assert.match(hintFor("بله: Bad Request: chat not found", "send_text")!, /شناسه‌ی چت/);
    assert.match(hintFor("زمان اتصال تمام شد (احتمالاً محدودیت IP خارجی)", "network")!, /پراکسی/);
    assert.match(hintFor("Conflict: can't use getUpdates method while webhook is active", "receive")!, /وبهوک/);
    assert.match(hintFor("بله: Forbidden: bot was blocked by the user", "send_text")!, /بلاک/);
    assert.equal(hintFor("something odd", "auth"), undefined);
  });

  test("test image is a valid PNG", () => {
    const png = testImagePng(40, 20);
    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(png.readUInt32BE(16), 40);
    assert.equal(png.readUInt32BE(20), 20);
    assert.equal(png.subarray(-8, -4).toString("ascii"), "IEND");
  });
});
