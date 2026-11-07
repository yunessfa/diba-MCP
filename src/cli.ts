#!/usr/bin/env node
/**
 * dibaMCP — خط فرمان
 *
 *   npx diba-mcp                 داشبورد + سرور MCP
 *   diba-mcp stdio               برای Claude Desktop
 *   diba-mcp netcheck            تست دسترسی به API پیام‌رسان‌ها
 *   diba-mcp token               نمایش توکن MCP
 *   diba-mcp reset-password      حذف رمز داشبورد
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { SERVER_VERSION } from "./core/engine.js";
import { ConfigStore } from "./core/store.js";
import { printNetcheck, startHttp, startStdio } from "./server.js";

const HELP = `dibaMCP v${SERVER_VERSION} — سرور MCP برای پیام‌رسان‌های ایرانی، با داشبورد فارسی

استفاده:
  diba-mcp [start]          اجرای داشبورد و اندپوینت MCP (پیش‌فرض)
  diba-mcp stdio            اجرا با stdio برای Claude Desktop و کلاینت‌های مشابه
  diba-mcp netcheck         بررسی دسترسی این سیستم به API بله، ایتا، روبیکا و سروش
  diba-mcp token            نمایش توکن اتصال MCP
  diba-mcp reset-password   حذف رمز داشبورد (اجرای بعدی کد راه‌اندازی می‌دهد)

گزینه‌ها:
  -p, --port <n>       پورت (پیش‌فرض 3790 یا PORT)
  -H, --host <addr>    آدرس گوش دادن (پیش‌فرض 127.0.0.1؛ برای سرور: 0.0.0.0)
  -d, --data <dir>     پوشه‌ی تنظیمات و لاگ‌ها (پیش‌فرض ~/.diba-mcp یا DATA_DIR)
  -e, --env <file>     خواندن متغیرها از این فایل (پیش‌فرض .env در پوشه‌ی جاری، اگر باشد)
  -v, --version        نمایش نسخه
  -h, --help           همین راهنما

نمونه:
  npx diba-mcp --port 8080
  diba-mcp --host 0.0.0.0 --data /srv/diba
`;

function fail(msg: string): never {
  console.error(`خطا: ${msg}\n\nبرای راهنما: diba-mcp --help`);
  process.exit(2);
}

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      port: { type: "string", short: "p" },
      host: { type: "string", short: "H" },
      data: { type: "string", short: "d" },
      env: { type: "string", short: "e" },
      version: { type: "boolean", short: "v" },
      help: { type: "boolean", short: "h" },
    },
  });
} catch (err: any) {
  fail(err.message);
}
const { values: o, positionals } = parsed;

if (o.help) {
  console.log(HELP);
  process.exit(0);
}
if (o.version) {
  console.log(SERVER_VERSION);
  process.exit(0);
}

// متغیرهای محیطی: فایل داده‌شده، یا .env پوشه‌ی جاری
if (o.env) {
  if (!existsSync(o.env)) fail(`فایل ${o.env} پیدا نشد`);
  process.loadEnvFile(o.env);
} else if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const dataDir = resolve(o.data ?? process.env.DATA_DIR ?? join(homedir(), ".diba-mcp"));
const command = positionals[0] ?? "start";
if (positionals.length > 1) fail(`آرگومان اضافه: ${positionals.slice(1).join(" ")}`);

switch (command) {
  case "start": {
    const port = Number(o.port ?? process.env.PORT ?? 3790);
    if (!Number.isInteger(port) || port < 1 || port > 65535) fail(`پورت نامعتبر: ${o.port ?? process.env.PORT}`);
    try {
      await startHttp({ port, host: o.host ?? process.env.HOST ?? "127.0.0.1", dataDir, trustProxy: process.env.TRUST_PROXY });
    } catch {
      process.exit(1);
    }
    break;
  }
  case "stdio":
    await startStdio({ dataDir });
    break;
  case "netcheck":
    process.exit((await printNetcheck({ dataDir })) ? 0 : 1);
  case "token": {
    console.log(new ConfigStore(dataDir).mcpToken);
    break;
  }
  case "reset-password": {
    new ConfigStore(dataDir).clearAdmin();
    console.log("رمز داشبورد حذف شد. با اجرای بعدی، کد راه‌اندازی در ترمینال چاپ می‌شود.");
    if (process.env.ADMIN_PASSWORD) console.log("توجه: ADMIN_PASSWORD در env تنظیم است و همچنان همان رمز کار می‌کند.");
    break;
  }
  default:
    fail(`دستور ناشناخته: ${command}`);
}
