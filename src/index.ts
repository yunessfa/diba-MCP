/**
 * نقطه‌ی ورود کتابخانه — برای الحاق به پروژه‌ی دیگر:
 *
 *   import express from "express";
 *   import { createDibaMcp } from "diba-mcp";
 *
 *   const dibaMcp = createDibaMcp({ dataDir: "./data/diba-mcp" });
 *   app.use("/diba-mcp", dibaMcp.router());          // داشبورد + /mcp
 *   // یا مستقیم از کد خودتان:
 *   await dibaMcp.engine.callTool("bale_send_message", { text: "سلام" }, "dashboard");
 */
import { resolve } from "node:path";
import { DibaMcpEngine } from "./core/engine.js";
import { configureProxy } from "./core/net.js";
import type { ProviderDef } from "./core/types.js";
import { createDibaMcpRouter, type RouterOptions } from "./http/router.js";
import { builtinProviders } from "./providers/index.js";

export interface CreateOptions {
  dataDir?: string;
  /** سرویس‌های اضافه (مثلاً سرویس اختصاصی پروژه‌ی میزبان) */
  extraProviders?: ProviderDef[];
  /** فقط این سرویس‌ها بارگذاری شوند */
  only?: string[];
  env?: NodeJS.ProcessEnv;
}

export function createDibaMcp(opts: CreateOptions = {}) {
  configureProxy(opts.env ?? process.env);
  let providers = [...builtinProviders, ...(opts.extraProviders ?? [])];
  if (opts.only) providers = providers.filter((p) => opts.only!.includes(p.id));
  const engine = new DibaMcpEngine({
    dataDir: resolve(opts.dataDir ?? process.env.DATA_DIR ?? "./data"),
    providers,
    env: opts.env,
  });
  return {
    engine,
    /** express.Router شامل /mcp ، /api و داشبورد */
    router: (o?: RouterOptions) => createDibaMcpRouter(engine, o),
    /** یک McpServer برای اتصال به هر transport دلخواه (stdio و ...) */
    createMcpServer: () => engine.createMcpServer(),
  };
}

export { DibaMcpEngine } from "./core/engine.js";
export { defineTool, ProviderError } from "./core/types.js";
export type { ProviderDef, ToolDef, ProviderField, ProviderContext } from "./core/types.js";
export { createTelegramLikeProvider } from "./providers/telegram-like.js";
export { builtinProviders } from "./providers/index.js";
export { createDibaMcpRouter } from "./http/router.js";
export { configureProxy, proxyMode } from "./core/net.js";
export { runNetcheck } from "./core/netcheck.js";
