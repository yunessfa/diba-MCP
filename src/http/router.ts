import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { hashPassword, RateLimiter, safeEqual, SessionStore, verifyPassword } from "../core/auth.js";
import { SERVER_VERSION, type IranMcpEngine } from "../core/engine.js";
import { runNetcheck } from "../core/netcheck.js";

export interface RouterOptions {
  /** نمایش داشبورد (پیش‌فرض: true). در پروژه‌ی میزبان می‌توانید خاموشش کنید */
  dashboard?: boolean;
  /** پوشه‌ی فایل‌های داشبورد */
  publicDir?: string;
}

const COOKIE = "imcp_sid";
const defaultPublic = fileURLToPath(new URL("../../public", import.meta.url));

/**
 * یک express.Router کامل:
 *   POST /mcp         ← اندپوینت MCP (Streamable HTTP، بدون نشست)
 *   /api/*            ← API داشبورد
 *   /                 ← داشبورد
 * پروژه‌ی میزبان: app.use("/iran-mcp", createIranMcpRouter(engine))
 */
export function createIranMcpRouter(engine: IranMcpEngine, opts: RouterOptions = {}): Router {
  const router = express.Router();
  const sessions = new SessionStore();
  const loginLimiter = new RateLimiter();
  const env = process.env;

  // کد راه‌اندازی اولیه — فقط وقتی هنوز رمز ادمین تعیین نشده
  let setupCode: string | null = null;
  const needsSetup = () => !env.ADMIN_PASSWORD && !engine.store.admin;
  if (needsSetup()) {
    setupCode = randomBytes(3).toString("hex").toUpperCase();
    console.error(`\n[iran-mcp] کد راه‌اندازی داشبورد: ${setupCode}\n`);
  }

  // ---------------- MCP ----------------
  const mcpAuth = (req: Request, res: Response, next: NextFunction) => {
    const h = req.headers.authorization ?? "";
    const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
    if (!token || !safeEqual(token, engine.store.mcpToken)) {
      res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized: invalid MCP token" }, id: null });
      return;
    }
    next();
  };

  router.post("/mcp", express.json({ limit: "4mb" }), mcpAuth, async (req, res) => {
    const server = engine.createMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("[iran-mcp] MCP error", err);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
      }
    }
  });
  const notAllowed = (_req: Request, res: Response) => {
    res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server)" }, id: null });
  };
  router.get("/mcp", notAllowed);
  router.delete("/mcp", notAllowed);

  if (opts.dashboard === false) return router;

  // ---------------- API داشبورد ----------------
  const api = express.Router();
  api.use(express.json({ limit: "1mb" }));

  const sid = (req: Request) => parseCookie(req.headers.cookie ?? "")[COOKIE];
  const setCookie = (req: Request, res: Response, value: string, maxAge?: number) => {
    const path = req.baseUrl.replace(/\/api$/, "") || "/";
    const secure = req.secure || req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
    const age = maxAge === undefined ? "" : `; Max-Age=${maxAge}`;
    res.setHeader("Set-Cookie", `${COOKIE}=${value}; Path=${path}; HttpOnly; SameSite=Strict${secure}${age}`);
  };

  api.get("/auth/status", (req, res) => {
    res.json({ authenticated: sessions.valid(sid(req)), needsSetup: needsSetup(), version: SERVER_VERSION });
  });

  api.post("/auth/setup", (req, res) => {
    if (!needsSetup()) return void res.status(400).json({ error: "رمز ادمین قبلاً تعیین شده است" });
    if (!loginLimiter.allow(req.ip ?? "?")) return void res.status(429).json({ error: "تلاش زیاد؛ چند دقیقه بعد امتحان کنید" });
    const { code, password } = req.body ?? {};
    if (!setupCode || String(code ?? "").trim().toUpperCase() !== setupCode)
      return void res.status(403).json({ error: "کد راه‌اندازی اشتباه است (در کنسول سرور چاپ شده)" });
    if (typeof password !== "string" || password.length < 8)
      return void res.status(400).json({ error: "رمز باید حداقل ۸ کاراکتر باشد" });
    engine.store.setAdmin(hashPassword(password));
    setupCode = null;
    setCookie(req, res, sessions.create());
    res.json({ ok: true });
  });

  api.post("/auth/login", (req, res) => {
    if (!loginLimiter.allow(req.ip ?? "?")) return void res.status(429).json({ error: "تلاش زیاد؛ چند دقیقه بعد امتحان کنید" });
    const password = String(req.body?.password ?? "");
    const ok = env.ADMIN_PASSWORD
      ? safeEqual(password, env.ADMIN_PASSWORD)
      : engine.store.admin
        ? verifyPassword(password, engine.store.admin)
        : false;
    if (!ok) return void res.status(401).json({ error: "رمز عبور اشتباه است" });
    setCookie(req, res, sessions.create());
    res.json({ ok: true });
  });

  api.post("/auth/logout", (req, res) => {
    sessions.destroy(sid(req));
    setCookie(req, res, "", 0);
    res.json({ ok: true });
  });

  // از اینجا به بعد ورود لازم است
  api.use((req, res, next) => {
    if (!sessions.valid(sid(req))) return void res.status(401).json({ error: "ابتدا وارد شوید" });
    next();
  });

  api.get("/overview", (_req, res) => {
    const providers = engine.describeProviders();
    res.json({
      version: SERVER_VERSION,
      providers: providers.map(({ id, nameFa, name, color, glyph, enabled, ready, tools }) => ({
        id, nameFa, name, color, glyph, enabled, ready, toolCount: tools.length,
      })),
      activeTools: engine.activeTools().length + 1,
      totalTools: providers.reduce((s, p) => s + p.tools.length, 0) + 1,
      stats: engine.logger.stats(),
      recent: engine.logger.list(6),
      uptime: Math.round(process.uptime()),
    });
  });

  api.get("/providers", (_req, res) => res.json(engine.describeProviders()));

  api.put("/providers/:id", (req, res) => {
    const p = engine.provider(String(req.params.id));
    if (!p) return void res.status(404).json({ error: "سرویس پیدا نشد" });
    const { enabled, values } = req.body ?? {};
    const clean: Record<string, string> = {};
    for (const f of p.fields) {
      const v = values?.[f.key];
      if (typeof v !== "string") continue;
      if (f.type === "secret" && v === "") continue; // خالی = بدون تغییر
      if (f.type === "url" && v && !/^https?:\/\//i.test(v))
        return void res.status(400).json({ error: `«${f.label}» باید با http یا https شروع شود` });
      clean[f.key] = v;
    }
    if (values?.__clear && Array.isArray(values.__clear)) {
      for (const k of values.__clear) if (p.fields.some((f) => f.key === k)) clean[k] = "";
    }
    engine.store.update(p.id, { enabled: typeof enabled === "boolean" ? enabled : undefined, values: clean });
    res.json(engine.describeProviders().find((x) => x.id === p.id));
  });

  api.post("/providers/:id/test", async (req, res) => {
    res.json(await engine.testProvider(String(req.params.id)));
  });

  api.post("/tools/:name/call", async (req, res) => {
    res.json(await engine.callTool(String(req.params.name), req.body?.args ?? {}, "dashboard"));
  });

  api.get("/logs", (req, res) => res.json(engine.logger.list(Number(req.query.limit) || 100)));
  api.delete("/logs", (_req, res) => {
    engine.logger.clear();
    res.json({ ok: true });
  });

  api.get("/netcheck", async (_req, res) => res.json(await runNetcheck(engine)));

  api.get("/connection", (_req, res) => {
    res.json({ token: engine.store.mcpToken, fromEnv: engine.store.mcpTokenFromEnv });
  });
  api.post("/connection/rotate", (_req, res) => {
    if (engine.store.mcpTokenFromEnv) return void res.status(400).json({ error: "توکن از MCP_TOKEN در env خوانده می‌شود؛ آنجا عوضش کنید" });
    res.json({ token: engine.store.rotateMcpToken() });
  });

  router.use("/api", api);

  // ---------------- فایل‌های داشبورد ----------------
  router.use((req, res, next) => {
    // مسیرهای نسبی داشبورد به اسلش پایانی نیاز دارند
    if (req.method === "GET" && req.path === "/" && req.baseUrl && !req.originalUrl.split("?")[0].endsWith("/")) {
      return void res.redirect(301, req.originalUrl.replace(/(\?|$)/, "/$1"));
    }
    next();
  });
  router.use(express.static(opts.publicDir ?? defaultPublic, { index: "index.html", maxAge: "1h" }));

  return router;
}

function parseCookie(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
