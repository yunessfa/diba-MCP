/** اجرای مستقل HTTP (Docker و npm run dev/start) — تنظیمات از env */
import { existsSync } from "node:fs";
import { startHttp } from "./server.js";

if (existsSync(".env")) process.loadEnvFile(".env");

await startHttp({
  port: Number(process.env.PORT) || 3790,
  host: process.env.HOST ?? "127.0.0.1",
  trustProxy: process.env.TRUST_PROXY,
});
