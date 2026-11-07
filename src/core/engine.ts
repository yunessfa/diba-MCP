import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { redact } from "./http.js";
import { join } from "node:path";
import { RateLimiter } from "./auth.js";
import { CallLogger } from "./logger.js";
import { ConfigStore, envKey } from "./store.js";
import { ProviderError, type ProviderDef, type ToolDef } from "./types.js";

// پیام‌های خطای اعتبارسنجی به فارسی
z.config(z.locales.fa());

export const SERVER_NAME = "diba-mcp";
export const SERVER_VERSION = "0.1.0";

export interface EngineOptions {
  /** پوشه‌ی ذخیره‌ی config.json */
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

/**
 * قلب پروژه: نگهداری سرویس‌ها، تنظیمات، لاگ و ساخت سرور MCP.
 * هم نسخه‌ی مستقل (main.ts) و هم پروژه‌ی میزبان از همین کلاس استفاده می‌کنند.
 */
export class DibaMcpEngine {
  readonly store: ConfigStore;
  readonly logger: CallLogger;
  readonly providers: ProviderDef[];
  /** سقف فراخوانی ابزارهای «نوشتنی» (ارسال پیام و ...) از طرف مدل در دقیقه */
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
  }

  provider(id: string) {
    return this.providers.find((p) => p.id === id);
  }

  /** ابزارهایی که الان قابل استفاده‌اند (سرویس فعال + تنظیمات کامل) */
  activeTools() {
    return [...this.toolIndex.values()].filter(({ provider }) => this.store.isReady(provider));
  }

  /** اجرای یک ابزار با اعتبارسنجی ورودی و ثبت لاگ */
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
        args: rawArgs,
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

    const { values } = this.store.resolve(provider);
    try {
      const result = await tool.handler(parsed.data, { config: values });
      return finish({ ok: true, result });
    } catch (err: any) {
      const msg = err instanceof ProviderError ? err.message : `خطای داخلی: ${err?.message ?? err}`;
      return finish({ ok: false, error: redact(msg, Object.values(values)) });
    }
  }

  /** تست اتصال یک سرویس (حتی اگر غیرفعال باشد) */
  async testProvider(id: string): Promise<CallResult> {
    const p = this.provider(id);
    const started = performance.now();
    const ms = () => Math.round(performance.now() - started);
    if (!p) return { ok: false, ms: 0, error: "سرویس پیدا نشد" };
    if (!p.test) return { ok: false, ms: 0, error: "این سرویس تست اتصال ندارد" };
    const missing = this.store.missingFields(p);
    if (missing.length) return { ok: false, ms: 0, error: `اول این فیلدها را پر کنید: ${missing.join("، ")}` };
    const { values } = this.store.resolve(p);
    try {
      return { ok: true, ms: ms(), result: await p.test({ config: values }) };
    } catch (err: any) {
      return { ok: false, ms: ms(), error: redact(err?.message ?? String(err), Object.values(values)) };
    }
  }

  /**
   * یک McpServer تازه با ابزارهای فعال می‌سازد.
   * در حالت HTTP بدون‌نشست، برای هر درخواست یک نمونه ساخته می‌شود تا تغییر
   * تنظیمات در داشبورد بلافاصله اعمال شود.
   */
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

  // ---------- داده برای داشبورد ----------
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
        fields: p.fields.map((f) => ({
          ...f,
          envName: envKey(p.id, f.key),
          fromEnv: fromEnv[f.key],
          // مقدار secret هیچ‌وقت کامل به مرورگر نمی‌رود
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
