/**
 * لایه‌ی شبکه: همه‌ی درخواست‌های بیرونی از اینجا رد می‌شوند تا بشود
 * برای سرورهای خارج از ایران، ترافیک را از یک پراکسی داخل ایران عبور داد.
 *
 *   SOCKS_PROXY=socks5://user:pass@host:1080     ← مثلاً تونل ssh -D به سرور ایران
 *   HTTPS_PROXY=http://host:3128                 ← پراکسی HTTP معمولی
 *   NO_PROXY=localhost,127.0.0.1                 ← آدرس‌هایی که مستقیم بروند
 */
import { Agent, EnvHttpProxyAgent, fetch as undiciFetch, FormData as UndiciFormData, Socks5ProxyAgent, type Dispatcher } from "undici";

let dispatcher: Dispatcher = new Agent();
let mode: { type: "direct" | "http" | "socks5"; target?: string } = { type: "direct" };

function hidePassword(url: string) {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return url;
  }
}

/** یک بار در شروع برنامه صدا زده می‌شود (env را می‌خواند) */
export function configureProxy(env: NodeJS.ProcessEnv = process.env) {
  const socks = env.SOCKS_PROXY || env.socks_proxy;
  const http = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy;
  if (socks) {
    const u = new URL(socks);
    dispatcher = new Socks5ProxyAgent(`socks5://${u.hostname}:${u.port || 1080}`, {
      username: u.username ? decodeURIComponent(u.username) : undefined,
      password: u.password ? decodeURIComponent(u.password) : undefined,
    });
    mode = { type: "socks5", target: hidePassword(socks) };
  } else if (http) {
    dispatcher = new EnvHttpProxyAgent({
      httpProxy: env.HTTP_PROXY || env.http_proxy || http,
      httpsProxy: env.HTTPS_PROXY || env.https_proxy || http,
      noProxy: env.NO_PROXY ?? env.no_proxy ?? "",
    });
    mode = { type: "http", target: hidePassword(http) };
  } else {
    dispatcher = new Agent();
    mode = { type: "direct" };
  }
  return mode;
}

export function proxyMode() {
  return mode;
}

export type FetchInit = Parameters<typeof undiciFetch>[1];

export function netFetch(url: string, init: FetchInit = {}) {
  return undiciFetch(url, { ...init, dispatcher });
}

export { UndiciFormData as FormData };

const EXPLAIN: Record<string, string> = {
  ENOTFOUND: "دامنه پیدا نشد (DNS)",
  EAI_AGAIN: "DNS جواب نداد",
  ECONNREFUSED: "اتصال رد شد",
  ECONNRESET: "اتصال وسط کار قطع شد (احتمالاً محدودیت IP خارجی)",
  ETIMEDOUT: "زمان اتصال تمام شد (احتمالاً محدودیت IP خارجی)",
  UND_ERR_CONNECT_TIMEOUT: "زمان اتصال تمام شد (احتمالاً محدودیت IP خارجی)",
  UND_ERR_SOCKET: "اتصال قطع شد",
  TimeoutError: "جوابی نیامد (احتمالاً محدودیت IP خارجی)",
};

/** خطای شبکه را به یک جمله‌ی فارسی قابل فهم تبدیل می‌کند */
export function describeNetError(err: any): string {
  if (err?.name === "TimeoutError") return `${EXPLAIN.TimeoutError} — Timeout`;
  // عمیق‌ترین علت را پیدا کن
  const chain: any[] = [];
  for (let e = err; e && chain.length < 5; e = e.cause) chain.push(e);
  const text = chain.map((e) => String(e?.message ?? "")).join(" | ");
  const proxy = text.match(/Proxy response \((\d+)\)/);
  if (proxy) return `پراکسی اتصال را رد کرد (HTTP ${proxy[1]})`;
  if (/socks/i.test(text)) return `خطای پراکسی SOCKS: ${chain.at(-1)?.message}`;
  const code = chain.map((e) => e?.code).find((c) => typeof c === "string");
  if (code && EXPLAIN[code]) return `${EXPLAIN[code]} — ${code}`;
  return chain.at(-1)?.message || String(err);
}
