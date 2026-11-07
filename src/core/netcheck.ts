import type { IranMcpEngine } from "./engine.js";
import { describeNetError, netFetch, proxyMode } from "./net.js";

export interface NetResult {
  id: string;
  name: string;
  url: string;
  reachable: boolean;
  status?: number;
  ms: number;
  error?: string;
}

async function probe(url: string, timeoutMs: number) {
  const started = performance.now();
  try {
    const res = await netFetch(url, { method: "GET", signal: AbortSignal.timeout(timeoutMs), redirect: "manual" });
    await res.body?.cancel();
    return { reachable: true, status: res.status, ms: Math.round(performance.now() - started) };
  } catch (err: any) {
    return { reachable: false, ms: Math.round(performance.now() - started), error: describeNetError(err) };
  }
}

/**
 * بررسی می‌کند سرور فعلی (مثلاً سرور آلمان) به API هر سرویس دسترسی دارد یا نه.
 * هر پاسخ HTTP (حتی 404) یعنی مسیر شبکه باز است.
 */
export async function runNetcheck(engine: IranMcpEngine, timeoutMs = 10_000) {
  const targets = engine.providers.map((p) => {
    const base = engine.store.resolve(p).values.baseUrl || p.fields.find((f) => f.key === "baseUrl")?.default || "";
    return { id: p.id, name: p.nameFa, url: base };
  });

  const [ip, ...results] = await Promise.all([
    netFetch("https://api.ipify.org?format=json", { signal: AbortSignal.timeout(timeoutMs) })
      .then((r) => r.json() as Promise<{ ip: string }>)
      .then((j) => j.ip)
      .catch(() => null),
    ...targets.map(async (t) => ({ ...t, ...(await probe(t.url, timeoutMs)) }) as NetResult),
  ]);

  return { proxy: proxyMode(), egressIp: ip as string | null, results: results as NetResult[], checkedAt: new Date().toISOString() };
}
