import { lookup } from "node:dns/promises";
import { z } from "zod";
import { isIP } from "node:net";
import { netFetch } from "./net.js";
import { ProviderError } from "./types.js";

export const MAX_MEDIA_BYTES = 20 * 1024 * 1024;

export interface Media {
  blob: Blob;
  filename: string;
  mime: string;
}

let allowPrivate = false;
export function configureMedia(env: NodeJS.ProcessEnv = process.env) {
  allowPrivate = env.ALLOW_PRIVATE_MEDIA_URLS === "true" || env.ALLOW_PRIVATE_MEDIA_URLS === "1";
}

export function isUploadable(value: string): boolean {
  return /^https?:\/\//i.test(value) || /^data:/i.test(value);
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "application/pdf": "pdf",
  "application/zip": "zip",
  "text/plain": "txt",
};

function withExtension(name: string, mime: string): string {
  const clean = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 120) || "file";
  if (/\.[a-z0-9]{2,5}$/i.test(clean)) return clean;
  const ext = EXT[mime.split(";")[0].trim().toLowerCase()];
  return ext ? `${clean}.${ext}` : clean;
}

function tooBig(max: number): never {
  throw new ProviderError(`حجم فایل بیشتر از ${Math.round(max / 1048576)} مگابایت است`);
}

function fromDataUrl(value: string, max: number): Media {
  const comma = value.indexOf(",");
  if (comma < 0) throw new ProviderError("data URL نامعتبر است");
  const header = value.slice(5, comma).split(";");
  const mime = header[0] || "application/octet-stream";
  const nameParam = header.find((h) => h.startsWith("name="));
  const isBase64 = header.includes("base64");
  const payload = value.slice(comma + 1);
  if (isBase64 && payload.length * 0.75 > max * 1.01) tooBig(max);
  const buf = isBase64 ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "utf8");
  if (buf.byteLength === 0) throw new ProviderError("فایل خالی است");
  if (buf.byteLength > max) tooBig(max);
  const name = nameParam ? decodeURIComponent(nameParam.slice(5)) : "file";
  return { blob: new Blob([buf], { type: mime }), filename: withExtension(name, mime), mime };
}

function privateIPv4(ip: string) {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}
function embeddedIPv4(hi: string, lo: string) {
  const a = parseInt(hi, 16), b = parseInt(lo, 16);
  return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
}

function privateIP(ip: string): boolean {
  if (isIP(ip) === 4) return privateIPv4(ip);
  const v6 = ip.toLowerCase();
  const dotted = v6.match(/^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return privateIPv4(dotted[1]);
  const hex = v6.match(/^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) return privateIPv4(embeddedIPv4(hex[1], hex[2]));
  return (
    v6.startsWith("::") ||
    /^f[cd]/.test(v6) ||
    /^fe[89ab]/.test(v6) ||
    v6.startsWith("ff")
  );
}

async function assertPublicUrl(url: URL) {
  if (allowPrivate) return;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new ProviderError("دانلود از آدرس داخلی مجاز نیست");
  }
  let addrs: string[];
  if (isIP(host)) addrs = [host];
  else {
    try {
      addrs = (await lookup(host, { all: true })).map((a) => a.address);
    } catch {
      return;
    }
  }
  if (addrs.some(privateIP)) throw new ProviderError("دانلود از آدرس داخلی مجاز نیست");
}

async function fromHttpUrl(value: string, max: number): Promise<Media> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ProviderError("لینک فایل نامعتبر است");
  }
  for (let hop = 0; hop < 5; hop++) {
    await assertPublicUrl(url);
    let res: Awaited<ReturnType<typeof netFetch>>;
    try {
      res = await netFetch(url.toString(), { redirect: "manual", signal: AbortSignal.timeout(60_000) });
    } catch (err: any) {
      throw new ProviderError(`دانلود فایل ناموفق بود: ${err?.name === "TimeoutError" ? "زمان تمام شد" : err?.cause?.code ?? err?.message}`);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      await res.body?.cancel();
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    if (!res.ok) throw new ProviderError(`دانلود فایل ناموفق بود (HTTP ${res.status})`);
    if (Number(res.headers.get("content-length") ?? 0) > max) tooBig(max);
    const buf = await res.arrayBuffer();
    if (buf.byteLength > max) tooBig(max);
    if (buf.byteLength === 0) throw new ProviderError("فایل دانلودشده خالی است");
    const mime = (res.headers.get("content-type") ?? "application/octet-stream").split(";")[0].trim();
    const name = decodeURIComponent(url.pathname.split("/").pop() || "file");
    return { blob: new Blob([buf], { type: mime }), filename: withExtension(name, mime), mime };
  }
  throw new ProviderError("ریدایرکت‌های لینک فایل بیش از حد است");
}

export async function loadMedia(value: string, opts: { max?: number; filename?: string; expect?: "image" } = {}): Promise<Media> {
  const max = opts.max ?? MAX_MEDIA_BYTES;
  const media = /^data:/i.test(value) ? fromDataUrl(value, max) : await fromHttpUrl(value, max);
  if (opts.expect === "image" && !media.mime.startsWith("image/") && media.mime !== "application/octet-stream") {
    throw new ProviderError(`این فایل عکس نیست (${media.mime})`);
  }
  if (opts.filename) media.filename = withExtension(opts.filename, media.mime);
  return media;
}

export function summarizeForLog(value: unknown): unknown {
  if (typeof value === "string") {
    if (/^data:/i.test(value) && value.length > 200) {
      const comma = value.indexOf(",");
      return `${value.slice(0, Math.min(comma, 80))},… (${Math.round((value.length - comma) * 0.75 / 1024)} KB)`;
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(summarizeForLog);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, summarizeForLog(v)]));
  }
  return value;
}

export function mediaField(kind: "image" | "file", what: string) {
  return z
    .string()
    .min(1)
    .meta({ "x-media": kind })
    .describe(`${what}: a public https URL (the server downloads and uploads it), a data: URL, or an existing file_id from this messenger`);
}
