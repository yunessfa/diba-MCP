import { describeNetError, FormData, netFetch } from "./net.js";
import { ProviderError } from "./types.js";

const DEFAULT_TIMEOUT = Number(process.env.UPSTREAM_TIMEOUT_MS) || 20_000;

/** توکن‌ها را از متن خطا/لاگ پاک می‌کند */
export function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length > 4) out = out.split(s).join("***");
  }
  return out;
}

export interface RequestOptions {
  method?: "GET" | "POST";
  json?: unknown;
  form?: FormData | URLSearchParams;
  timeoutMs?: number;
  /** برای پاک کردن از پیام خطا */
  secrets?: string[];
}

/** درخواست HTTP با timeout و پیام خطای فارسی */
export async function request(url: string, opts: RequestOptions = {}): Promise<any> {
  const { method = "POST", json, form, timeoutMs = DEFAULT_TIMEOUT, secrets = [] } = opts;
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: string | FormData | URLSearchParams | undefined;
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  } else if (form) {
    body = form;
  }

  let res: Awaited<ReturnType<typeof netFetch>>;
  try {
    res = await netFetch(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err: any) {
    const reason =
      err?.name === "TimeoutError"
        ? `زمان پاسخ‌گویی سرور تمام شد (${timeoutMs / 1000} ثانیه)`
        : `اتصال به سرور برقرار نشد: ${describeNetError(err)}`;
    throw new ProviderError(redact(reason, secrets));
  }

  const text = await res.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text.slice(0, 500) };
  }
  if (!res.ok) {
    const desc = data?.description ?? data?.message ?? data?.raw ?? res.statusText;
    throw new ProviderError(redact(`خطای HTTP ${res.status}: ${desc}`, secrets), data);
  }
  return data;
}
