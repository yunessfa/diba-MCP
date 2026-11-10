import { resolve } from "node:path";
import { DibaMcpEngine, SERVER_VERSION } from "./core/engine.js";
import { configureMedia } from "./core/media.js";
import { configureProxy } from "./core/net.js";
import type { ProviderDef } from "./core/types.js";
import { createDibaMcpRouter, type RouterOptions } from "./http/router.js";
import { builtinProviders } from "./providers/index.js";

export interface CreateOptions {
  dataDir?: string;
  extraProviders?: ProviderDef[];
  only?: string[];
  env?: NodeJS.ProcessEnv;
}

export function createDibaMcp(opts: CreateOptions = {}) {
  configureProxy(opts.env ?? process.env);
  configureMedia(opts.env ?? process.env);
  let providers = [...builtinProviders, ...(opts.extraProviders ?? [])];
  if (opts.only) providers = providers.filter((p) => opts.only!.includes(p.id));
  const dataDir = resolve(opts.dataDir ?? process.env.DATA_DIR ?? "./data");
  const engine = new DibaMcpEngine({ dataDir, providers, env: opts.env });
  return {
    engine,
    dataDir,
    version: SERVER_VERSION,
    router: (o?: RouterOptions) => createDibaMcpRouter(engine, o),
    createMcpServer: () => engine.createMcpServer(),
  };
}

export { DibaMcpEngine, SERVER_VERSION } from "./core/engine.js";
export { startHttp, startStdio, printNetcheck } from "./server.js";
export { defineTool, ProviderError } from "./core/types.js";
export type { ProviderDef, ToolDef, ProviderField, ProviderContext } from "./core/types.js";
export { createTelegramLikeProvider } from "./providers/telegram-like.js";
export { builtinProviders } from "./providers/index.js";
export { createDibaMcpRouter } from "./http/router.js";
export { configureProxy, proxyMode } from "./core/net.js";
export { runNetcheck } from "./core/netcheck.js";
