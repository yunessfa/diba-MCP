# راه‌اندازی روی سرور (آلمان) — برنامه‌ی تست امشب

هدف اصلی تست: **آیا سرور آلمان به API پیام‌رسان‌های ایرانی می‌رسد؟**
خیلی از سرویس‌های ایرانی IP خارجی را محدود می‌کنند. اگر نرسید، «مسیر ب» (تونل به یک سرور ایران) هم آماده است.

---

## ۱. نصب داکر (یک بار)

```bash
curl -fsSL https://get.docker.com | sh
docker compose version     # باید نسخه را نشان دهد
```

## ۲. گرفتن پروژه

ریپو private است، پس یکی از این دو:

```bash
# با Personal Access Token (Settings → Developer settings → Fine-grained token، فقط Read روی همین ریپو)
git clone https://<TOKEN>@github.com/yunessfa/diba-mcp.git

# یا با کلید SSH سرور که در گیت‌هاب ثبت شده باشد
git clone git@github.com:yunessfa/diba-mcp.git
```

```bash
cd diba-mcp
cp .env.example .env
nano .env        # حداقل ADMIN_PASSWORD را عوض کنید
```

## ۳. اجرا

```bash
docker compose up -d --build
docker compose ps            # وضعیت باید healthy شود
docker compose logs -f       # دیدن لاگ (Ctrl+C برای خروج)
```

## ۴. تست اصلی: دسترسی شبکه ✅/❌

```bash
docker compose exec diba-mcp node dist/netcheck.js
```

خروجی برای هر پیام‌رسان یکی از این‌هاست:

| نتیجه | معنی |
|---|---|
| ✅ `HTTP 404` یا هر عدد دیگر | مسیر باز است. عالی؛ برو مرحله‌ی ۵ |
| ❌ `زمان اتصال تمام شد` / `اتصال وسط کار قطع شد` | IP آلمان بسته است ← «مسیر ب» |
| ❌ `دامنه پیدا نشد (DNS)` | مشکل DNS سرور یا آدرس اشتباه |

همین تست در داشبورد هم هست: «نمای کلی» ← «بررسی دسترسی».

## ۵. باز کردن داشبورد

پورت به‌صورت پیش‌فرض فقط روی خود سرور باز است (امن‌تر). از لپ‌تاپ تونل بزنید:

```bash
ssh -L 3790:127.0.0.1:3790 root@SERVER_IP
```

حالا در مرورگر: **http://localhost:3790** و با `ADMIN_PASSWORD` وارد شوید.

> تست سریع بدون تونل: در `.env` بگذارید `BIND_ADDR=0.0.0.0`، بعد `docker compose up -d` و برو به `http://SERVER_IP:3790`.
> بعد از تست حتماً برگردانید؛ داشبورد بدون HTTPS روی اینترنت باز نماند.

بعد:
1. «پیام‌رسان‌ها» ← توکن بله/ایتا/روبیکا/سروش را وارد و روشن کنید ← «تست اتصال»
2. «آزمایش ابزارها» ← `*_send_message` ← یک پیام واقعی بفرستید

---

## مسیر ب: اگر سرور آلمان به APIها نرسید

ترافیک را از یک سرور **داخل ایران** عبور می‌دهیم. کافی است دسترسی SSH به یک سرور ایرانی داشته باشید.

### روش ۱: تونل SOCKS با SSH (ساده‌ترین)

روی سرور آلمان:

```bash
# IP رابط docker0 (معمولاً 172.17.0.1)
ip -4 addr show docker0 | grep inet

# تونل را روی همان IP باز کنید تا کانتینر به آن برسد ولی از اینترنت بسته بماند
ssh -f -N -o ServerAliveInterval=30 -D 172.17.0.1:1080 user@IRAN_SERVER_IP
```

اگر فایروال ufw روشن است، اجازه‌ی رسیدن کانتینرها به تونل را بدهید (از اینترنت همچنان بسته است):

```bash
ufw allow from 172.16.0.0/12 to 172.17.0.1 port 1080 proto tcp
```

در `.env`:

```
SOCKS_PROXY=socks5://host.docker.internal:1080
NO_PROXY=localhost,127.0.0.1
```

```bash
docker compose up -d                                   # اعمال env جدید
docker compose exec diba-mcp node dist/netcheck.js     # «IP خروجی» باید IP سرور ایران باشد
```

**دائمی کردن تونل** (بعد از ری‌استارت هم برقرار بماند):

```bash
apt install -y autossh
ssh-copy-id user@IRAN_SERVER_IP        # ورود بدون رمز

cat > /etc/systemd/system/diba-tunnel.service <<'EOF'
[Unit]
Description=SOCKS tunnel to Iran server for diba-mcp
After=network-online.target docker.service
Wants=network-online.target

[Service]
Environment=AUTOSSH_GATETIME=0
ExecStart=/usr/bin/autossh -M 0 -N -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -D 172.17.0.1:1080 user@IRAN_SERVER_IP
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload && systemctl enable --now diba-tunnel
```

### روش ۲: پراکسی HTTP روی سرور ایران

اگر روی سرور ایران squid یا tinyproxy با رمز دارید:

```
HTTPS_PROXY=http://user:pass@IRAN_SERVER_IP:3128
NO_PROXY=localhost,127.0.0.1
```

---

## اتصال Claude و کلاینت‌های دیگر (نیاز به HTTPS)

1. یک ساب‌دامنه (مثلاً `mcp.example.com`) با رکورد A به IP سرور آلمان
2. پورت‌های 80 و 443 در فایروال باز باشند
3. در `.env`:
   ```
   DOMAIN=mcp.example.com
   TRUST_PROXY=1
   ```
4. اجرا:
   ```bash
   docker compose --profile https up -d
   ```
5. داشبورد: `https://mcp.example.com` — اندپوینت MCP: `https://mcp.example.com/mcp`
6. در داشبورد ← «اتصال به هوش مصنوعی» دستور آماده‌ی Claude Code و بقیه را کپی کنید.

---

## دستورهای روزمره

| کار | دستور |
|---|---|
| لاگ زنده | `docker compose logs -f diba-mcp` |
| ری‌استارت | `docker compose restart diba-mcp` |
| آپدیت از گیت | `git pull && docker compose up -d --build` |
| توقف | `docker compose down` (داده‌ها در volume می‌مانند) |
| بکاپ تنظیمات | `docker compose cp diba-mcp:/app/data/config.json ./backup-config.json` |
| تست شبکه | `docker compose exec diba-mcp node dist/netcheck.js` |

**فراموشی رمز داشبورد:** `ADMIN_PASSWORD` در `.env` همیشه اولویت دارد؛ عوضش کنید و `docker compose up -d`.

---

## چک‌لیست امشب (نتیجه‌ها را بفرستید)

- [ ] `docker compose ps` ← healthy
- [ ] خروجی کامل `netcheck` (مستقیم، بدون پراکسی)
- [ ] تست اتصال هر پیام‌رسان در داشبورد
- [ ] ارسال یک پیام واقعی از «آزمایش ابزارها»
- [ ] اگر چیزی بسته بود: نتیجه‌ی netcheck بعد از «مسیر ب»
