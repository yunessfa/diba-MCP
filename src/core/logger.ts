import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

export interface CallLog {
  id: string;
  time: string;
  tool: string;
  provider: string;
  source: "mcp" | "dashboard";
  ok: boolean;
  ms: number;
  args: unknown;
  result?: string;
  error?: string;
}

export interface LoggerOptions {
  /** پوشه‌ی فایل‌های لاگ. اگر نباشد لاگ فقط در حافظه می‌ماند */
  dir?: string;
  /** تعداد لاگ نگه‌داشته‌شده در حافظه برای داشبورد */
  max?: number;
  /** فایل‌های قدیمی‌تر از این تعداد روز پاک می‌شوند */
  retentionDays?: number;
}

const FILE_RE = /^calls-(\d{4}-\d{2}-\d{2})\.jsonl$/;

/**
 * لاگ فراخوانی ابزارها:
 *  - در حافظه (برای داشبورد، سریع)
 *  - و در فایل روزانه‌ی JSONL در data/logs (بعد از ری‌استارت هم می‌ماند)
 */
export class CallLogger {
  private items: CallLog[] = [];
  private readonly max: number;
  private readonly dir?: string;
  private readonly retentionDays: number;

  constructor(opts: LoggerOptions = {}) {
    this.max = opts.max ?? 300;
    this.dir = opts.dir;
    this.retentionDays = opts.retentionDays ?? 14;
    if (this.dir) {
      mkdirSync(this.dir, { recursive: true });
      this.prune();
      this.loadRecent();
    }
  }

  private files(): { name: string; day: string }[] {
    if (!this.dir || !existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .map((name) => ({ name, m: name.match(FILE_RE) }))
      .filter((f) => f.m)
      .map((f) => ({ name: f.name, day: f.m![1] }))
      .sort((a, b) => b.day.localeCompare(a.day));
  }

  /** حذف فایل‌های قدیمی‌تر از retentionDays */
  prune(now = new Date()) {
    const cutoff = new Date(now.getTime() - this.retentionDays * 86_400_000).toISOString().slice(0, 10);
    for (const f of this.files()) if (f.day < cutoff) rmSync(join(this.dir!, f.name), { force: true });
  }

  private loadRecent() {
    const out: CallLog[] = [];
    for (const f of this.files()) {
      const lines = readFileSync(join(this.dir!, f.name), "utf8").split("\n").filter(Boolean).reverse();
      for (const line of lines) {
        try {
          out.push(JSON.parse(line));
        } catch {
          /* خط خراب را رد کن */
        }
        if (out.length >= this.max) break;
      }
      if (out.length >= this.max) break;
    }
    this.items = out;
  }

  add(entry: Omit<CallLog, "id" | "time">): CallLog {
    const log: CallLog = { id: randomUUID(), time: new Date().toISOString(), ...entry };
    this.items.unshift(log);
    if (this.items.length > this.max) this.items.length = this.max;
    if (this.dir) {
      try {
        appendFileSync(join(this.dir, `calls-${log.time.slice(0, 10)}.jsonl`), JSON.stringify(log) + "\n", { mode: 0o600 });
      } catch (err) {
        console.error("[diba-mcp] نوشتن لاگ در فایل ناموفق بود", err);
      }
    }
    return log;
  }

  list(limit = 100): CallLog[] {
    return this.items.slice(0, limit);
  }

  clear() {
    this.items = [];
    for (const f of this.files()) rmSync(join(this.dir!, f.name), { force: true });
  }

  stats() {
    const today = new Date().toISOString().slice(0, 10);
    const t = this.items.filter((i) => i.time.startsWith(today));
    const ok = t.filter((i) => i.ok).length;
    return {
      today: t.length,
      successRate: t.length ? Math.round((ok / t.length) * 100) : null,
      avgMs: t.length ? Math.round(t.reduce((s, i) => s + i.ms, 0) / t.length) : null,
    };
  }
}
