/**
 * نقطه‌ی ورود کتابخانه — برای الحاق به پروژه‌ی دیگر:
 *
 *   import express from "express";
 *   import { createIranMcp } from "iran-mcp";
 *
 *   const iranMcp = createIranMcp({ dataDir: "./data/iran-mcp" });
 *   app.use("/iran-mcp", iranMcp.router());          // داشبورد + /mcp
 *   // یا مستقیم از کد خودتان:
 *   await iranMcp.engine.callTool("bale_send_message", { text: "سلام" }, "dashboard");
 */
import { resolve } from "node:path";
import { IranMcpEngine } from "./core/engine.js";
import { configureProxy } from "./core/net.js";
import type { ProviderDef } from "./core/types.js";
import { createIranMcpRouter, type RouterOptions } from "./http/router.js";
import { builtinProviders } from "./providers/index.js";

export interface CreateOptions {
  dataDir?: string;
  /** سرویس‌های اضافه (مثلاً سرویس اختصاصی پروژه‌ی میزبان) */
  extraProviders?: ProviderDef[];
  /** فقط این سرویس‌ها بارگذاری شوند */
  only?: string[];
  env?: NodeJS.ProcessEnv;
}

export function createIranMcp(opts: CreateOptions = {}) {
  configureProxy(opts.env ?? process.env);
  let providers = [...builtinProviders, ...(opts.extraProviders ?? [])];
  if (opts.only) providers = providers.filter((p) => opts.only!.includes(p.id));
  const engine = new IranMcpEngine({
    dataDir: resolve(opts.dataDir ?? process.env.DATA_DIR ?? "./data"),
    providers,
    env: opts.env,
  });
  return {
    engine,
    /** express.Router شامل /mcp ، /api و داشبورد */
    router: (o?: RouterOptions) => createIranMcpRouter(engine, o),
    /** یک McpServer برای اتصال به هر transport دلخواه (stdio و ...) */
    createMcpServer: () => engine.createMcpServer(),
  };
}

export { IranMcpEngine } from "./core/engine.js";
export { defineTool, ProviderError } from "./core/types.js";
export type { ProviderDef, ToolDef, ProviderField, ProviderContext } from "./core/types.js";
export { createTelegramLikeProvider } from "./providers/telegram-like.js";
export { builtinProviders } from "./providers/index.js";
export { createIranMcpRouter } from "./http/router.js";
export { configureProxy, proxyMode } from "./core/net.js";
export { runNetcheck } from "./core/netcheck.js";
