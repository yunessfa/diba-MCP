import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { redact } from "./http.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RateLimiter } from "./auth.js";
import { Inbox } from "./inbox.js";
import { CallLogger } from "./logger.js";
import { summarizeForLog } from "./media.js";
import { ConfigStore, envKey } from "./store.js";
import { ProviderError, type ProviderContext, type ProviderDef, type ToolDef } from "./types.js";

z.config(z.locales.fa());

export const SERVER_NAME = "diba-mcp";
export const SERVER_VERSION: string = (() => {
  try {
    return JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;
  } catch {
    return "0.0.0";
  }
})();

export interface EngineOptions {
  dataDir: string;
  providers: ProviderDef[];
  env?: NodeJS.ProcessEnv;
}

export interface CallResult {
  ok: boolean;
  ms: number;
  result?: unknown;
  error?: string;
}

export class DibaMcpEngine {
  readonly store: ConfigStore;
  readonly logger: CallLogger;
  readonly providers: ProviderDef[];
  readonly inbox: Inbox;
  readonly version = SERVER_VERSION;
  private writeLimiter: RateLimiter;
  private toolIndex = new Map<string, { tool: ToolDef<any>; provider: ProviderDef }>();

  constructor(opts: EngineOptions) {
    const env = opts.env ?? process.env;
    this.store = new ConfigStore(opts.dataDir, env);
    this.logger = new CallLogger({
      dir: env.LOG_TO_FILE === "false" ? undefined : join(opts.dataDir, "logs"),
      retentionDays: Number(env.LOG_RETENTION_DAYS) || 14,
    });
    this.writeLimiter = new RateLimiter(Math.max(1, Number(env.MCP_WRITE_LIMIT) || 30), 60_000);
    this.providers = opts.providers;
    for (const p of this.providers) {
      for (const t of p.tools) {
        if (this.toolIndex.has(t.name)) throw new Error(`نام ابزار تکراری است: ${t.name}`);
        this.toolIndex.set(t.name, { tool: t, provider: p });
      }
    }
    this.inbox = new Inbox(opts.dataDir, this.store, this.providers, (p) => this.contextOf(p));
  }

  contextOf(p: ProviderDef): ProviderContext {
    return {
      config: this.store.resolve(p).values,
      inbox: this.inbox.isActive(p) ? this.inbox.access(p.id) : undefined,
    };
  }

  updateProvider(id: string, patch: { enabled?: boolean; receive?: boolean; values?: Record<string, string> }) {
    this.store.update(id, patch);
    this.inbox.sync();
  }

  async runAction(id: string, name: string): Promise<CallResult> {
    const p = this.provider(id);
    const action = p?.actions?.[name];
    const started = performance.now();
    if (!p || !action) return { ok: false, ms: 0, error: "این کار برای این سرویس تعریف نشده" };
    if (this.store.missingFields(p).length) return { ok: false, ms: 0, error: "اول توکن را ثبت کنید" };
    const ctx = this.contextOf(p);
    try {
      const result = await action.run(ctx);
      return { ok: true, ms: Math.round(performance.now() - started), result };
    } catch (err: any) {
      return { ok: false, ms: Math.round(performance.now() - started), error: redact(err?.message ?? String(err), Object.values(ctx.config)) };
    }
  }

  provider(id: string) {
    return this.providers.find((p) => p.id === id);
  }

  activeTools() {
    return [...this.toolIndex.values()].filter(({ provider }) => this.store.isReady(provider));
  }

  async callTool(name: string, rawArgs: unknown, source: "mcp" | "dashboard"): Promise<CallResult> {
    const entry = this.toolIndex.get(name);
    const started = performance.now();
    const finish = (r: Omit<CallResult, "ms">): CallResult => {
      const ms = Math.round(performance.now() - started);
      this.logger.add({
        tool: name,
        provider: entry?.provider.id ?? "?",
        source,
        ok: r.ok,
        ms,
        args: summarizeForLog(rawArgs),
        error: r.error,
        result: r.ok ? JSON.stringify(r.result ?? null).slice(0, 2000) : undefined,
      });
      return { ...r, ms };
    };

    if (!entry) return finish({ ok: false, error: `ابزاری با نام «${name}» وجود ندارد` });
    const { tool, provider } = entry;
    if (!this.store.isEnabled(provider)) return finish({ ok: false, error: `سرویس ${provider.nameFa} غیرفعال است` });
    const missing = this.store.missingFields(provider);
    if (missing.length) return finish({ ok: false, error: `تنظیمات ${provider.nameFa} کامل نیست: ${missing.join("، ")}` });

    if (source === "mcp" && !tool.annotations?.readOnlyHint && !this.writeLimiter.allow("mcp")) {
      return finish({
        ok: false,
        error: `محدودیت ارسال: حداکثر ${this.writeLimiter.max} فراخوانی ارسالی در دقیقه. ${this.writeLimiter.retryAfter("mcp")} ثانیه دیگر دوباره امتحان کنید.`,
      });
    }

    const parsed = z.object(tool.input).safeParse(rawArgs ?? {});
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "ورودی"}: ${i.message}`).join(" | ");
      return finish({ ok: false, error: `ورودی نامعتبر — ${msg}` });
    }

    const ctx = this.contextOf(provider);
    const values = ctx.config;
    try {
      const result = await tool.handler(parsed.data, ctx);
      this.recordSent(provider, tool.name, parsed.data as Record<string, unknown>, result, source);
      return finish({ ok: true, result });
    } catch (err: any) {
      const msg = err instanceof ProviderError ? err.message : `خطای داخلی: ${err?.message ?? err}`;
      return finish({ ok: false, error: redact(msg, Object.values(values)) });
    }
  }

  private recordSent(provider: ProviderDef, toolName: string, args: Record<string, unknown>, result: unknown, source: "mcp" | "dashboard") {
    if (!/_send_/.test(toolName)) return;
    try {
      const chatId = String(args.chat_id || this.store.resolve(provider).values.defaultChatId || "");
      if (!chatId) return;
      const r: any = result;
      const messageId = r?.message_id ?? r?.result?.message_id ?? r?.data?.message_id;
      const kind = /_send_photo$/.test(toolName)
        ? "photo"
        : /_send_(document|file)$/.test(toolName)
          ? "file"
          : /_send_location$/.test(toolName)
            ? "location"
            : "text";
      const media = [args.photo, args.document, args.file].find((v) => typeof v === "string") as string | undefined;
      const text =
        (args.text as string | undefined) ??
        (args.caption as string | undefined) ??
        (kind === "location" ? `${args.latitude}, ${args.longitude}` : undefined);
      this.inbox.recordOutgoing(provider.id, {
        chatId,
        messageId: messageId !== undefined ? String(messageId) : undefined,
        text,
        kind,
        source,
        mediaUrl: media && /^https?:\/\//i.test(media) ? media : undefined,
      });
    } catch (err) {
      console.error("[diba-mcp] ثبت پیام ارسالی ناموفق بود", err);
    }
  }

  async testProvider(id: string): Promise<CallResult> {
    const p = this.provider(id);
    const started = performance.now();
    const ms = () => Math.round(performance.now() - started);
    if (!p) return { ok: false, ms: 0, error: "سرویس پیدا نشد" };
    if (!p.test) return { ok: false, ms: 0, error: "این سرویس تست اتصال ندارد" };
    const missing = this.store.missingFields(p);
    if (missing.length) return { ok: false, ms: 0, error: `اول این فیلدها را پر کنید: ${missing.join("، ")}` };
    const ctx = this.contextOf(p);
    const values = ctx.config;
    try {
      return { ok: true, ms: ms(), result: await p.test(ctx) };
    } catch (err: any) {
      return { ok: false, ms: ms(), error: redact(err?.message ?? String(err), Object.values(values)) };
    }
  }

  createMcpServer(): McpServer {
    const server = new McpServer(
      { name: SERVER_NAME, version: SERVER_VERSION },
      {
        instructions:
          "Tools for Iranian services (messengers: Bale, Eitaa, Rubika, Soroush Plus). Tool names are prefixed with the service id. Call list_services first if unsure what is configured.",
      },
    );

    server.registerTool(
      "list_services",
      {
        title: "فهرست سرویس‌ها",
        description: "List the Iranian services this server knows, whether each is enabled/configured, and its tool names.",
        inputSchema: {},
        annotations: { readOnlyHint: true },
      },
      async () => {
        const data = this.providers.map((p) => ({
          id: p.id,
          name: p.name,
          nameFa: p.nameFa,
          ready: this.store.isReady(p),
          hasDefaultChat: Boolean(this.store.resolve(p).values.defaultChatId),
          tools: p.tools.map((t) => t.name),
        }));
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      },
    );

    server.registerTool(
      "list_chats",
      {
        title: "فهرست چت‌ها",
        description:
          "List chats (users, groups, channels) that have recently messaged the bots, with their chat_id, title and last message. " +
          "Use it to find the chat_id to send to. Only works for messengers where 'receive messages' is turned on in the dashboard.",
        inputSchema: { provider: z.string().optional().describe("Messenger id, e.g. bale or rubika") },
        annotations: { readOnlyHint: true },
      },
      async ({ provider }) => {
        const statuses = this.inbox.statuses().filter((s) => s.supported && (!provider || s.provider === provider));
        const data = {
          receiving: statuses.map((s) => ({ provider: s.provider, enabled: s.enabled })),
          chats: this.inbox.chats(provider).slice(0, 100),
        };
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      },
    );

    for (const { tool } of this.activeTools()) {
      server.registerTool(
        tool.name,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: tool.input,
          annotations: { title: tool.title, ...tool.annotations },
        },
        async (args: unknown) => {
          const r = await this.callTool(tool.name, args, "mcp");
          return r.ok
            ? { content: [{ type: "text" as const, text: JSON.stringify(r.result ?? { ok: true }, null, 2) }] }
            : { content: [{ type: "text" as const, text: r.error ?? "خطا" }], isError: true };
        },
      );
    }
    return server;
  }

  describeProviders() {
    return this.providers.map((p) => {
      const { values, fromEnv } = this.store.resolve(p);
      return {
        id: p.id,
        name: p.name,
        nameFa: p.nameFa,
        category: p.category,
        color: p.color,
        glyph: p.glyph,
        description: p.description,
        docsUrl: p.docsUrl,
        enabled: this.store.isEnabled(p),
        ready: this.store.isReady(p),
        missing: this.store.missingFields(p),
        hasTest: Boolean(p.test),
        receive: {
          supported: Boolean(p.receive),
          enabled: this.store.isReceiving(p),
          fromEnv: this.store.receiveFromEnv(p),
        },
        actions: Object.entries(p.actions ?? {}).map(([name, a]) => ({ name, title: a.title })),
        fields: p.fields.map((f) => ({
          ...f,
          envName: envKey(p.id, f.key),
          fromEnv: fromEnv[f.key],
          value: f.type === "secret" ? "" : values[f.key] ?? "",
          masked: f.type === "secret" && values[f.key] ? maskSecret(values[f.key]) : "",
          hasValue: Boolean(values[f.key]),
        })),
        tools: p.tools.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          annotations: t.annotations ?? {},
          schema: z.toJSONSchema(z.object(t.input), { io: "input" }),
        })),
      };
    });
  }
}

function maskSecret(s: string) {
  return s.length <= 8 ? "••••" : `${s.slice(0, 4)}••••${s.slice(-4)}`;
}
