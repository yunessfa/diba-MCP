/**
 * اجرا با stdio — برای کلاینت‌هایی مثل Claude Desktop که سرور را خودشان اجرا می‌کنند.
 * تنظیمات از همان data/config.json (که با داشبورد پر شده) یا env خوانده می‌شود.
 * توجه: در این حالت هیچ‌چیز نباید روی stdout چاپ شود؛ لاگ‌ها به stderr می‌روند.
 */
import { existsSync } from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createDibaMcp } from "./index.js";

if (existsSync(".env")) process.loadEnvFile(".env");

const dibaMcp = createDibaMcp();
const server = dibaMcp.createMcpServer();
await server.connect(new StdioServerTransport());
console.error(`[diba-mcp] stdio آماده است — ${dibaMcp.engine.activeTools().length} ابزار فعال`);
