# dibaMCP

سرور MCP برای وصل کردن سرویس‌های ایرانی به مدل‌های هوش مصنوعی (Claude، Cursor و هر کلاینت MCP دیگر)، همراه با داشبورد فارسی برای مدیریت.

**مرحله‌ی ۱ (همین نسخه):** پیام‌رسان‌ها — بله، ایتا، روبیکا، سروش‌پلاس

## اجرا

```bash
npm install
npm run dev          # داشبورد: http://127.0.0.1:3790  —  MCP: http://127.0.0.1:3790/mcp
```

بار اول یک **کد راه‌اندازی** شش‌حرفی در کنسول چاپ می‌شود. با آن در داشبورد رمز ادمین را بسازید.
بعد در بخش «پیام‌رسان‌ها» توکن ربات‌ها را ثبت و روشن کنید و در «اتصال به هوش مصنوعی» آدرس و توکن MCP را بردارید.

| دستور | کار |
|---|---|
| `npm run dev` | اجرای توسعه با ری‌لود خودکار |
| `npm run build` و `npm start` | ساخت و اجرای نسخه‌ی production |
| `npm run stdio` | اجرا در حالت stdio (برای Claude Desktop) |
| `npm test` | همه‌ی تست‌ها (واحد + سرتاسری) |
| `npm run typecheck` | بررسی تایپ‌ها |
| `npm run netcheck` | بررسی دسترسی این سرور به API پیام‌رسان‌ها |

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
├─ main.ts            # اجرای مستقل HTTP
└─ stdio.ts           # اجرای stdio
public/               # داشبورد (HTML/CSS/JS ساده، بدون build)
test/
├─ unit/             # تست‌های واحد (auth، store، net، engine)
└─ e2e.ts            # تست سرتاسری با کلاینت واقعی MCP
```

## ابزارها

| پیام‌رسان | ابزارها |
|---|---|
| بله | `bale_get_me` `bale_send_message` `bale_send_photo` `bale_get_chat` `bale_get_updates` |
| سروش‌پلاس | `soroush_get_me` `soroush_send_message` `soroush_send_photo` `soroush_get_chat` `soroush_get_updates` |
| ایتا | `eitaa_get_me` `eitaa_send_message` `eitaa_send_file` |
| روبیکا | `rubika_get_me` `rubika_send_message` `rubika_send_location` `rubika_get_chat` `rubika_get_updates` |
| همه | `list_services` |

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
import { createDibaMcp } from "diba-mcp";   // یا مسیر نسبی به پوشه‌ی پروژه

const app = express();
const dibaMcp = createDibaMcp({ dataDir: "./data/diba-mcp" });

app.use("/diba-mcp", dibaMcp.router());                  // داشبورد + /diba-mcp/mcp
// app.use("/diba-mcp", dibaMcp.router({ dashboard: false }));  // فقط اندپوینت MCP

// استفاده‌ی مستقیم از کد، بدون مدل:
await dibaMcp.engine.callTool("eitaa_send_message", { text: "سفارش جدید" }, "dashboard");
```

تا وقتی روی npm منتشر نشده، در package.json پروژه‌ی میزبان: `"diba-mcp": "file:../diba-mcp"` و یک بار `npm run build` در همین پروژه.

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
