import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export function hashPassword(password: string, salt = randomBytes(16).toString("hex")) {
  const hash = scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

export function verifyPassword(password: string, stored: { salt: string; hash: string }): boolean {
  const h = scryptSync(password, stored.salt, 64);
  const s = Buffer.from(stored.hash, "hex");
  return h.length === s.length && timingSafeEqual(h, s);
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * نشست داشبورد به‌صورت کوکی امضاشده (HMAC) — بدون نگهداری در حافظه،
 * پس با ری‌استارت سرور کسی بیرون نمی‌افتد.
 * باطل کردن همه‌ی نشست‌ها: بالا بردن epoch (خروج یا تغییر رمز).
 */
export class SignedSessions {
  constructor(
    private secret: () => string,
    private epoch: () => number,
    private ttlMs = 12 * 60 * 60 * 1000,
  ) {}

  private sign(payload: string) {
    return createHmac("sha256", this.secret()).update(payload).digest("base64url");
  }

  create(now = Date.now()): string {
    const payload = Buffer.from(JSON.stringify({ exp: now + this.ttlMs, e: this.epoch() })).toString("base64url");
    return `${payload}.${this.sign(payload)}`;
  }

  valid(token?: string, now = Date.now()): boolean {
    if (!token) return false;
    const [payload, sig] = token.split(".");
    if (!payload || !sig || !safeEqual(sig, this.sign(payload))) return false;
    try {
      const { exp, e } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      return typeof exp === "number" && exp > now && e === this.epoch();
    } catch {
      return false;
    }
  }
}

/** محدودکننده‌ی پنجره‌ی ثابت (برای ورود و اندپوینت MCP) */
export class RateLimiter {
  private hits = new Map<string, { n: number; reset: number }>();
  private lastSweep = 0;

  constructor(
    readonly max = 8,
    readonly windowMs = 10 * 60 * 1000,
  ) {}

  /** true یعنی اجازه دارد */
  allow(key: string, now = Date.now()): boolean {
    this.sweep(now);
    const h = this.hits.get(key);
    if (!h || h.reset <= now) {
      this.hits.set(key, { n: 1, reset: now + this.windowMs });
      return true;
    }
    h.n++;
    return h.n <= this.max;
  }

  /** چند ثانیه تا آزاد شدن */
  retryAfter(key: string, now = Date.now()): number {
    const h = this.hits.get(key);
    return h ? Math.max(1, Math.ceil((h.reset - now) / 1000)) : 0;
  }

  /** پاک کردن کلیدهای منقضی تا حافظه بی‌نهایت بزرگ نشود */
  private sweep(now: number) {
    if (now - this.lastSweep < this.windowMs) return;
    this.lastSweep = now;
    for (const [k, v] of this.hits) if (v.reset <= now) this.hits.delete(k);
  }
}
