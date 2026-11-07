/**
 * تست دسترسی شبکه از همین سرور به API پیام‌رسان‌ها:
 *   npm run netcheck                                  (توسعه)
 *   docker compose exec iran-mcp node dist/netcheck.js (داخل داکر)
 */
import { existsSync } from "node:fs";
import { runNetcheck } from "./core/netcheck.js";
import { createIranMcp } from "./index.js";

if (existsSync(".env")) process.loadEnvFile(".env");

const { engine } = createIranMcp();
const r = await runNetcheck(engine);

const via = r.proxy.type === "direct" ? "مستقیم (بدون پراکسی)" : `${r.proxy.type} → ${r.proxy.target}`;
console.log(`\nمسیر خروجی: ${via}`);
console.log(`IP خروجی:   ${r.egressIp ?? "نامعلوم"}\n`);
for (const x of r.results) {
  const mark = x.reachable ? "✅" : "❌";
  const info = x.reachable ? `HTTP ${x.status}` : x.error;
  console.log(`${mark} ${x.name.padEnd(10)} ${String(x.ms).padStart(5)}ms  ${info}\n   ${x.url}`);
}
const ok = r.results.filter((x) => x.reachable).length;
console.log(`\n${ok} از ${r.results.length} سرویس در دسترس است.`);
if (ok < r.results.length && r.proxy.type === "direct") {
  console.log("برای سرویس‌های بسته، SOCKS_PROXY یا HTTPS_PROXY را به یک سرور داخل ایران تنظیم کنید (DEPLOY.md).");
}
process.exit(ok === r.results.length ? 0 : 1);
