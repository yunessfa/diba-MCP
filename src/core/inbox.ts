import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { redact } from "./http.js";
import type { ConfigStore } from "./store.js";
import type { IncomingMessage, InboxAccess, ProviderContext, ProviderDef } from "./types.js";

export interface ChatSummary {
  provider: string;
  chatId: string;
  title?: string;
  type: IncomingMessage["chatType"];
  lastText?: string;
  lastDirection?: "in" | "out";
  lastDate: string;
  count: number;
}

export interface ReceiverStatus {
  provider: string;
  supported: boolean;
  enabled: boolean;
  running: boolean;
  lastPollAt?: string;
  lastError?: string;
  lastErrorAt?: string;
  received: number;
}

interface InboxFile {
  cursor?: string;
  messages: IncomingMessage[];
}

const MAX_MESSAGES = 500;

export class Inbox {
  private dir: string;
  private data = new Map<string, InboxFile>();
  private status = new Map<string, ReceiverStatus>();
  private loops = new Map<string, { stop: boolean; wake?: () => void }>();
  private saveTimers = new Map<string, NodeJS.Timeout>();
  private started = false;
  idleMs?: number;
  longPollSec = 20;

  constructor(
    dataDir: string,
    private store: ConfigStore,
    private providers: ProviderDef[],
    private ctxOf: (p: ProviderDef) => ProviderContext,
  ) {
    this.dir = join(dataDir, "inbox");
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
  }

  private file(id: string) {
    return join(this.dir, `${id}.json`);
  }

  private load(id: string, fresh = false): InboxFile {
    if (this.data.has(id) && (!fresh || this.saveTimers.has(id))) return this.data.get(id)!;
    let d: InboxFile = { messages: [] };
    if (existsSync(this.file(id))) {
      try {
        d = JSON.parse(readFileSync(this.file(id), "utf8"));
        if (!Array.isArray(d.messages)) d.messages = [];
      } catch {
        d = { messages: [] };
      }
    }
    this.data.set(id, d);
    return d;
  }

  private save(id: string) {
    clearTimeout(this.saveTimers.get(id));
    this.saveTimers.set(
      id,
      setTimeout(() => this.flush(id), 300),
    );
  }

  private flush(id: string) {
    clearTimeout(this.saveTimers.get(id));
    this.saveTimers.delete(id);
    const d = this.data.get(id);
    if (!d) return;
    const tmp = this.file(id) + ".tmp";
    writeFileSync(tmp, JSON.stringify(d), { mode: 0o600 });
    renameSync(tmp, this.file(id));
  }

  add(id: string, messages: IncomingMessage[], cursor?: string): number {
    const d = this.load(id, !this.loops.has(id));
    const known = new Set(d.messages.map((m) => m.key));
    const fresh = messages.filter((m) => !known.has(m.key));
    if (fresh.length) {
      d.messages = [...fresh.reverse(), ...d.messages].slice(0, MAX_MESSAGES);
    }
    if (cursor !== undefined) d.cursor = cursor;
    if (fresh.length || cursor !== undefined) this.save(id);
    return fresh.length;
  }

  messages(id: string, opts: { chatId?: string; limit?: number } = {}): IncomingMessage[] {
    const d = this.load(id, !this.loops.has(id));
    const list = (opts.chatId ? d.messages.filter((m) => m.chatId === opts.chatId) : d.messages.slice())
      .sort((a, b) => b.date.localeCompare(a.date));
    return list.slice(0, Math.min(Math.max(opts.limit ?? 50, 1), MAX_MESSAGES));
  }

  chats(providerId?: string): ChatSummary[] {
    const out = new Map<string, ChatSummary>();
    for (const p of this.providers) {
      if (providerId && p.id !== providerId) continue;
      if (!p.receive && !existsSync(this.file(p.id)) && !this.data.has(p.id)) continue;
      const sorted = this.load(p.id, !this.loops.has(p.id)).messages.slice().sort((a, b) => b.date.localeCompare(a.date));
      for (const m of sorted) {
        const k = `${m.provider}:${m.chatId}`;
        const c = out.get(k);
        if (!c) {
          out.set(k, {
            provider: m.provider,
            chatId: m.chatId,
            title: m.chatTitle,
            type: m.chatType,
            lastText: m.text ?? (m.kind !== "text" ? m.kind : undefined),
            lastDirection: m.direction ?? "in",
            lastDate: m.date,
            count: 1,
          });
        } else {
          c.count++;
          if (!c.title && m.chatTitle) c.title = m.chatTitle;
          if (c.type === "unknown" && m.chatType !== "unknown") c.type = m.chatType;
        }
      }
    }
    return [...out.values()].sort((a, b) => b.lastDate.localeCompare(a.lastDate));
  }

  recordOutgoing(
    id: string,
    m: { chatId: string; messageId?: string; text?: string; kind: IncomingMessage["kind"]; source: "mcp" | "dashboard"; mediaUrl?: string },
  ) {
    const known = this.load(id, !this.loops.has(id)).messages.find((x) => x.chatId === m.chatId && x.direction !== "out");
    const messageId = m.messageId || `local-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    this.add(id, [
      {
        key: `${id}:${m.chatId}:${messageId}`,
        provider: id,
        chatId: m.chatId,
        chatTitle: known?.chatTitle,
        chatType: known?.chatType ?? "unknown",
        messageId,
        text: m.text,
        kind: m.kind,
        date: new Date().toISOString(),
        direction: "out",
        source: m.source,
        mediaUrl: m.mediaUrl,
      },
    ]);
  }

  access(id: string): InboxAccess {
    return { list: (opts) => this.messages(id, opts) };
  }

  clear(id: string) {
    const d = this.load(id);
    d.messages = [];
    this.flush(id);
  }

  private st(p: ProviderDef): ReceiverStatus {
    let s = this.status.get(p.id);
    if (!s) {
      s = { provider: p.id, supported: Boolean(p.receive), enabled: false, running: false, received: 0 };
      this.status.set(p.id, s);
    }
    s.enabled = this.store.isReceiving(p);
    s.running = this.loops.has(p.id);
    return s;
  }

  statuses(): ReceiverStatus[] {
    return this.providers.map((p) => ({ ...this.st(p) }));
  }

  isActive(p: ProviderDef): boolean {
    return Boolean(p.receive) && this.store.isReceiving(p);
  }

  async fetchOnce(id: string): Promise<{ added: number }> {
    const p = this.providers.find((x) => x.id === id);
    if (!p?.receive) throw new Error("این پیام‌رسان دریافت پیام را پشتیبانی نمی‌کند");
    if (!this.store.isReady(p)) throw new Error("اول توکن را ثبت و سرویس را روشن کنید");
    const s = this.st(p);
    const ctx = this.ctxOf(p);
    try {
      const r = await p.receive.poll(ctx, this.load(p.id).cursor, 0);
      const added = this.add(p.id, r.messages, r.cursor);
      s.received += added;
      s.lastPollAt = new Date().toISOString();
      s.lastError = undefined;
      return { added };
    } catch (err: any) {
      s.lastError = redact(err?.message ?? String(err), Object.values(ctx.config));
      s.lastErrorAt = new Date().toISOString();
      throw err;
    }
  }

  sync() {
    if (!this.started) return;
    for (const p of this.providers) {
      const want = Boolean(p.receive) && this.store.isReady(p) && this.store.isReceiving(p);
      if (want && !this.loops.has(p.id)) this.startLoop(p);
      if (!want && this.loops.has(p.id)) this.stopLoop(p.id);
    }
  }

  start() {
    this.started = true;
    this.sync();
  }

  stop() {
    this.started = false;
    for (const id of [...this.loops.keys()]) this.stopLoop(id);
    for (const id of [...this.saveTimers.keys()]) this.flush(id);
  }

  private stopLoop(id: string) {
    const l = this.loops.get(id);
    if (l) {
      l.stop = true;
      l.wake?.();
    }
    this.loops.delete(id);
  }

  private startLoop(p: ProviderDef) {
    const loop: { stop: boolean; wake?: () => void } = { stop: false };
    this.loops.set(p.id, loop);
    const s = this.st(p);
    const idle = this.idleMs ?? p.receive!.idleMs ?? 1000;
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        const t = setTimeout(resolve, ms);
        loop.wake = () => {
          clearTimeout(t);
          resolve();
        };
      });

    (async () => {
      let failures = 0;
      while (!loop.stop) {
        const ctx = this.ctxOf(p);
        try {
          const r = await p.receive!.poll(ctx, this.load(p.id).cursor, this.longPollSec);
          if (loop.stop) break;
          s.received += this.add(p.id, r.messages, r.cursor);
          s.lastPollAt = new Date().toISOString();
          s.lastError = undefined;
          failures = 0;
          if (!r.messages.length) await sleep(idle);
        } catch (err: any) {
          if (loop.stop) break;
          failures++;
          s.lastError = redact(err?.message ?? String(err), Object.values(ctx.config));
          s.lastErrorAt = new Date().toISOString();
          await sleep(Math.min(60_000, Math.max(idle, 1000) * 2 ** Math.min(failures, 6)));
        }
      }
    })();
  }
}
