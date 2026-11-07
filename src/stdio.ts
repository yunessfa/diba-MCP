/**
 * اجرا با stdio — برای کلاینت‌هایی مثل Claude Desktop که سرور را خودشان اجرا می‌کنند.
 * تنظیمات از همان data/config.json (که با داشبورد پر شده) یا env خوانده می‌شود.
 * توجه: در این حالت هیچ‌چیز نباید روی stdout چاپ شود؛ لاگ‌ها به stderr می‌روند.
 */
import { existsSync } from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createIranMcp } from "./index.js";

if (existsSync(".env")) process.loadEnvFile(".env");

const iranMcp = createIranMcp();
const server = iranMcp.createMcpServer();
await server.connect(new StdioServerTransport());
console.error(`[iran-mcp] stdio آماده است — ${iranMcp.engine.activeTools().length} ابزار فعال`);
