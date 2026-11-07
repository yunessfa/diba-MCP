# dibaMCP

سرور MCP برای وصل کردن سرویس‌های ایرانی به مدل‌های هوش مصنوعی (Claude، Cursor و هر کلاینت MCP دیگر)، همراه با داشبورد فارسی برای مدیریت.

**مرحله‌ی ۱ (همین نسخه):** پیام‌رسان‌ها — بله، ایتا، روبیکا، سروش‌پلاس

## نصب و اجرا

پیش‌نیاز: Node.js نسخه‌ی ۲۲.۱۹ یا جدیدتر (یا فقط Docker).

**با npx — بدون نصب:**

```bash
npx diba-mcp
```

**نصب سراسری:**

```bash
npm install -g diba-mcp
diba-mcp
```

> تا قبل از انتشار روی npm، از فایل آماده‌ی آخرین [Release](https://github.com/yunessfa/diba-MCP/releases) نصب کنید:
> `npm i -g https://github.com/yunessfa/diba-MCP/releases/download/v0.3.0/diba-mcp-0.3.0.tgz`

**با Docker:**

```bash
docker run -d --name diba-mcp -p 127.0.0.1:3790:3790 \
  -e ADMIN_PASSWORD=your-password \
  -v diba-mcp-data:/app/data \
  ghcr.io/yunessfa/diba-mcp:latest
```

بعد مرورگر را باز کنید: **http://127.0.0.1:3790**

بار اول (اگر `ADMIN_PASSWORD` نداده باشید) یک **کد راه‌اندازی** شش‌حرفی در ترمینال چاپ می‌شود. با آن در داشبورد رمز بسازید.
بعد در «پیام‌رسان‌ها» توکن ربات‌ها را ثبت کنید و از «اتصال به هوش مصنوعی» آدرس و توکن MCP را بردارید.

### دستورهای CLI

| دستور | کار |
|---|---|
| `diba-mcp` | داشبورد + اندپوینت MCP |
| `diba-mcp stdio` | اجرا با stdio برای Claude Desktop |
| `diba-mcp netcheck` | آیا این سیستم به API بله، ایتا، روبیکا و سروش می‌رسد؟ |
| `diba-mcp token` | نمایش توکن اتصال MCP |
| `diba-mcp reset-password` | حذف رمز داشبورد (اجرای بعدی کد راه‌اندازی می‌دهد) |

گزینه‌ها: `--port 8080`، `--host 0.0.0.0`، `--data /path` (پیش‌فرض `~/.diba-mcp`)، `--env file.env`، `--help`

**Claude Desktop** (`claude_desktop_config.json`):

```json
{ "mcpServers": { "diba-mcp": { "command": "npx", "args": ["-y", "diba-mcp", "stdio"] } } }
```

### توسعه روی همین ریپو

| دستور | کار |
|---|---|
| `npm install` و `npm run dev` | اجرای توسعه با ری‌لود خودکار (داده در `./data`) |
| `npm run cli -- <دستور>` | اجرای CLI از روی سورس |
| `npm run build` و `npm start` | ساخت و اجرای نسخه‌ی production |
| `npm test` | همه‌ی تست‌ها (واحد + سرتاسری) |
| `npm run typecheck` | بررسی تایپ‌ها |
| `npm run netcheck` | بررسی دسترسی به API پیام‌رسان‌ها |

### انتشار نسخه‌ی جدید

```bash
npm version patch --no-git-tag-version   # یا minor / major
git commit -am "v0.2.1" && git push
```

بعد در گیت‌هاب: **Actions ← Release ← Run workflow**. (push یک تگ `vX.Y.Z` هم همین کار را می‌کند.)
GitHub Actions این‌ها را می‌سازد: ایمیج Docker با شماره‌ی نسخه، یک GitHub Release با فایل نصب `.tgz`، و اگر secret به اسم `NPM_TOKEN` در ریپو تعریف شده باشد، انتشار روی npm.

> نصب مستقیم از `github:yunessfa/diba-MCP` پشتیبانی نمی‌شود (npm هنگام نصب سراسری از git ابزار build را نصب نمی‌کند)؛ از فایل Release یا npm استفاده کنید.

## ساختار

```
src/
├─ core/
│  ├─ types.ts        # ProviderDef و ToolDef — قرارداد هر سرویس
│  ├─ engine.ts       # قلب پروژه: اجرای ابزار، اعتبارسنجی، لاگ، ساخت McpServer
│  ├─ store.ts        # تنظیمات در data/config.json (env اولویت دارد)
│  ├─ http.ts         # fetch با timeout و پیام خطای فارسی، پاک کردن توکن از خطاها
│  ├─ auth.ts         # رمز ادمین (scrypt)، نشست امضاشده (HMAC)، محدودکننده‌ی نرخ
│  ├─ net.ts          # همه‌ی درخواست‌های بیرونی + پراکسی SOCKS/HTTP
│  ├─ netcheck.ts     # تست دسترسی سرور به API پیام‌رسان‌ها
│  └─ logger.ts       # لاگ فراخوانی‌ها: حافظه + فایل روزانه در data/logs
├─ providers/
│  ├─ telegram-like.ts  # factory مشترک بله و سروش‌پلاس (Bot API شبیه تلگرام)
│  ├─ bale.ts  soroush.ts  eitaa.ts  rubika.ts
│  └─ index.ts          # فهرست سرویس‌ها
├─ http/router.ts     # express.Router: /mcp + /api + داشبورد
├─ index.ts           # API کتابخانه برای الحاق
├─ cli.ts             # خط فرمان diba-mcp
├─ server.ts          # راه‌اندازهای HTTP / stdio / netcheck
├─ main.ts            # اجرای HTTP از روی env (Docker، npm run dev)
└─ stdio.ts           # اجرای stdio
public/               # داشبورد (HTML/CSS/JS ساده، بدون build)
test/
├─ unit/             # تست‌های واحد (auth، store، net، engine)
└─ e2e.ts            # تست سرتاسری با کلاینت واقعی MCP
```

## ابزارها

| پیام‌رسان | ابزارها |
|---|---|
| بله | `bale_get_me` `bale_send_message` `bale_send_photo` `bale_send_document` `bale_get_chat` `bale_get_updates` |
| سروش‌پلاس | `soroush_get_me` `soroush_send_message` `soroush_send_photo` `soroush_send_document` `soroush_get_chat` `soroush_get_updates` |
| ایتا | `eitaa_get_me` `eitaa_send_message` `eitaa_send_photo` `eitaa_send_file` |
| روبیکا | `rubika_get_me` `rubika_send_message` `rubika_send_photo` `rubika_send_file` `rubika_send_location` `rubika_get_chat` `rubika_get_updates` |
| همه | `list_services` |

**ارسال عکس و فایل:** ورودی هر ابزار رسانه‌ای می‌تواند لینک عمومی، فایل انتخاب‌شده از دستگاه (در داشبورد: دکمه، کشیدن و رها کردن، یا Ctrl+V)، یا `file_id` قبلی همان پیام‌رسان باشد. لینک‌ها را خود سرور دانلود و آپلود می‌کند، پس لازم نیست پیام‌رسان به آن لینک دسترسی داشته باشد. حداکثر حجم ۲۰ مگابایت.
برای امنیت، دانلود از آدرس‌های داخلی (localhost، شبکه‌ی خصوصی، metadata ابری) مسدود است؛ اگر عمداً لازم دارید: `ALLOW_PRIVATE_MEDIA_URLS=true`.

اگر برای سرویسی «چت پیش‌فرض» تعیین کنید، `chat_id` اختیاری می‌شود و مدل می‌تواند فقط با `text` پیام بفرستد.

**محدودیت‌ها:** ایتایار فقط به کانال/گروه ارسال می‌کند و دریافت پیام ندارد. `get_updates` در بله و سروش وقتی webhook تنظیم شده باشد کار نمی‌کند.

## تنظیمات امنیت و محدودیت‌ها

| متغیر | پیش‌فرض | کار |
|---|---|---|
| `MCP_RATE_LIMIT` | `120` | حداکثر درخواست به `/mcp` در دقیقه برای هر IP |
| `MCP_WRITE_LIMIT` | `30` | حداکثر فراخوانی ابزارهای ارسالی (پیام، عکس، ...) از طرف مدل در دقیقه — جلوی ارسال انبوه ناخواسته را می‌گیرد |
| `LOG_RETENTION_DAYS` | `14` | فایل‌های لاگ قدیمی‌تر پاک می‌شوند |
| `LOG_TO_FILE` | `true` | `false` = لاگ فقط در حافظه |
| `UPSTREAM_TIMEOUT_MS` | `20000` | سقف انتظار برای جواب API پیام‌رسان‌ها |

نشست داشبورد کوکی امضاشده است و با ری‌استارت سرور از بین نمی‌رود. «خروج» همه‌ی نشست‌ها را باطل می‌کند.

## الحاق به پروژه‌ی دیگر

```js
import express from "express";
import { createDibaMcp } from "diba-mcp";   // npm i diba-mcp

const app = express();
const dibaMcp = createDibaMcp({ dataDir: "./data/diba-mcp" });

app.use("/diba-mcp", dibaMcp.router());                  // داشبورد + /diba-mcp/mcp
// app.use("/diba-mcp", dibaMcp.router({ dashboard: false }));  // فقط اندپوینت MCP

// استفاده‌ی مستقیم از کد، بدون مدل:
await dibaMcp.engine.callTool("eitaa_send_message", { text: "سفارش جدید" }, "dashboard");
```

تا وقتی روی npm منتشر نشده: `npm i https://github.com/yunessfa/diba-MCP/releases/download/v0.3.0/diba-mcp-0.3.0.tgz`

## اضافه کردن سرویس جدید

یک فایل در `src/providers/` بسازید:

```ts
import { z } from "zod";
import { defineTool, type ProviderDef } from "../core/types.js";
import { request } from "../core/http.js";

export const kavenegar: ProviderDef = {
  id: "kavenegar", name: "Kavenegar", nameFa: "کاوه‌نگار", category: "sms",
  color: "#0ea5e9", glyph: "ک", description: "ارسال پیامک",
  fields: [{ key: "apiKey", label: "کلید API", type: "secret", required: true }],
  tools: [
    defineTool({
      name: "kavenegar_send_sms", title: "ارسال پیامک",
      description: "Send an SMS via Kavenegar",
      input: { receptor: z.string(), message: z.string() },
      handler: (a, ctx) => request(`https://api.kavenegar.com/v1/${ctx.config.apiKey}/sms/send.json`, { json: a, secrets: [ctx.config.apiKey] }),
    }),
  ],
};
```

و در `src/providers/index.ts` به آرایه اضافه‌اش کنید. داشبورد، فرم تنظیمات، آزمایشگاه و ابزار MCP خودکار ساخته می‌شوند.

## استقرار با داکر

```bash
cp .env.example .env          # ADMIN_PASSWORD را عوض کنید
docker compose up -d --build
docker compose exec diba-mcp node dist/netcheck.js   # آیا سرور به APIها می‌رسد؟
```

راهنمای کامل قدم‌به‌قدم (سرور خارج از ایران، تونل SSH، HTTPS با Caddy): **[DEPLOY.md](DEPLOY.md)**

- **سرور خارج از ایران:** بعضی APIهای ایرانی IP خارجی را محدود می‌کنند. با `npm run netcheck` بررسی کنید؛ اگر بسته بود `SOCKS_PROXY` یا `HTTPS_PROXY` را به یک سرور داخل ایران بدهید. همه‌ی درخواست‌های بیرونی از `src/core/net.ts` رد می‌شوند.
- داشبورد را روی اینترنت فقط با HTTPS باز کنید (پروفایل `https` در compose، با `TRUST_PROXY=1`).
- تنظیمات و توکن‌ها در volume `diba-mcp-data` (فایل `config.json` با دسترسی 600) می‌مانند. هیچ‌وقت `.env` یا `data/` را commit نکنید.

## نقشه‌ی راه

1. ✅ پیام‌رسان‌ها: بله، ایتا، روبیکا، سروش‌پلاس
2. پیامک: کاوه‌نگار، SMS.ir، ملی‌پیامک
3. پرداخت: زرین‌پال، IDPay (ساخت لینک و verify — callback روی پروژه‌ی میزبان)
4. نقشه: نشان، Map.ir
5. ابزارهای آفلاین: کد ملی، شبا، تاریخ شمسی، اعداد فارسی
6. ذخیره‌ی لاگ در دیتابیس، چند کاربر و دسترسی جدا برای هر توکن
