import { randomUUID } from "node:crypto";

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

/** لاگ فراخوانی ابزارها در حافظه (حلقوی) */
export class CallLogger {
  private items: CallLog[] = [];
  constructor(private max = 300) {}

  add(entry: Omit<CallLog, "id" | "time">): CallLog {
    const log: CallLog = { id: randomUUID(), time: new Date().toISOString(), ...entry };
    this.items.unshift(log);
    if (this.items.length > this.max) this.items.length = this.max;
    return log;
  }

  list(limit = 100): CallLog[] {
    return this.items.slice(0, limit);
  }

  clear() {
    this.items = [];
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
