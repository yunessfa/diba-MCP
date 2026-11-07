/**
 * تست دسترسی شبکه از همین سرور به API پیام‌رسان‌ها:
 *   npm run netcheck                                   (توسعه)
 *   docker compose exec diba-mcp node dist/netcheck.js (داخل داکر)
 */
import { existsSync } from "node:fs";
import { printNetcheck } from "./server.js";

if (existsSync(".env")) process.loadEnvFile(".env");
process.exit((await printNetcheck()) ? 0 : 1);
