import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

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

/** نشست‌های داشبورد در حافظه (با ری‌استارت سرور پاک می‌شوند) */
export class SessionStore {
  private sessions = new Map<string, number>();
  constructor(private ttlMs = 12 * 60 * 60 * 1000) {}

  create(): string {
    const id = randomBytes(32).toString("base64url");
    this.sessions.set(id, Date.now() + this.ttlMs);
    return id;
  }

  valid(id?: string): boolean {
    if (!id) return false;
    const exp = this.sessions.get(id);
    if (!exp) return false;
    if (exp < Date.now()) {
      this.sessions.delete(id);
      return false;
    }
    return true;
  }

  destroy(id?: string) {
    if (id) this.sessions.delete(id);
  }
}

/** محدودکننده‌ی ساده برای تلاش‌های ورود */
export class RateLimiter {
  private hits = new Map<string, { n: number; reset: number }>();
  constructor(private max = 8, private windowMs = 10 * 60 * 1000) {}

  allow(key: string): boolean {
    const now = Date.now();
    const h = this.hits.get(key);
    if (!h || h.reset < now) {
      this.hits.set(key, { n: 1, reset: now + this.windowMs });
      return true;
    }
    h.n++;
    return h.n <= this.max;
  }
}
