/**
 * اجرا با stdio — برای کلاینت‌هایی مثل Claude Desktop که سرور را خودشان اجرا می‌کنند.
 * تنظیمات از data/config.json (که با داشبورد پر شده) یا env خوانده می‌شود.
 */
import { existsSync } from "node:fs";
import { startStdio } from "./server.js";

if (existsSync(".env")) process.loadEnvFile(".env");
await startStdio();
