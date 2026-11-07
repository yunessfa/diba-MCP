import { z } from "zod";
import { redact, request } from "../core/http.js";
import { isUploadable, loadMedia, mediaField } from "../core/media.js";
import { FormData, netFetch } from "../core/net.js";
import { defineTool, ProviderError, type ProviderContext, type ProviderDef } from "../core/types.js";
import { chatIdOf } from "./telegram-like.js";

/**
 * روبیکا Bot API نسخه ۳:
 *   {baseUrl}/{token}/{method}   — POST با JSON
 * پاسخ معمولاً به شکل { status: "OK", data: {...} } است.
 */
async function call(ctx: ProviderContext, method: string, body: Record<string, unknown> = {}) {
  const { token, baseUrl } = ctx.config;
  const clean = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined && v !== ""));
  const data = await request(`${baseUrl.replace(/\/+$/, "")}/${token}/${method}`, { json: clean, secrets: [token] });
  if (data && typeof data.status === "string" && data.status !== "OK") {
    throw new ProviderError(`روبیکا: ${data.dev_message ?? data.status}`, data);
  }
  return data?.data ?? data;
}

type RubikaFileType = "File" | "Image" | "Video" | "Gif" | "Music" | "Voice";

/**
 * آپلود در روبیکا سه مرحله دارد:
 *   ۱. requestSendFile {type}  → upload_url
 *   ۲. POST فایل به upload_url (multipart، فیلد file) → file_id
 *   ۳. sendFile {chat_id, file_id, text}
 */
async function uploadFile(ctx: ProviderContext, value: string, type: RubikaFileType, opts: { expect?: "image"; filename?: string } = {}) {
  if (!isUploadable(value)) return value; // file_id موجود
  const media = await loadMedia(value, opts);
  const { upload_url } = await call(ctx, "requestSendFile", { type });
  if (!upload_url) throw new ProviderError("روبیکا آدرس آپلود نداد");

  const form = new FormData();
  form.append("file", media.blob, media.filename);
  const secrets = [ctx.config.token];
  let res: Awaited<ReturnType<typeof netFetch>>;
  try {
    res = await netFetch(upload_url, { method: "POST", body: form, signal: AbortSignal.timeout(120_000) });
  } catch (err: any) {
    throw new ProviderError(redact(`آپلود فایل در روبیکا ناموفق بود: ${err?.cause?.code ?? err?.message}`, secrets));
  }
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text.slice(0, 300) };
  }
  if (!res.ok || (typeof data?.status === "string" && data.status !== "OK")) {
    throw new ProviderError(redact(`آپلود فایل در روبیکا ناموفق بود: ${data?.dev_message ?? data?.status ?? data?.raw ?? res.status}`, secrets), data);
  }
  const fileId = data?.data?.file_id ?? data?.file_id;
  if (!fileId) throw new ProviderError("روبیکا بعد از آپلود file_id برنگرداند", data);
  return String(fileId);
}

const chatId = z.string().optional().describe("Rubika chat_id (e.g. b0QF...). If omitted, the default chat from settings is used.");

export const rubika: ProviderDef = {
  id: "rubika",
  name: "Rubika",
  nameFa: "روبیکا",
  category: "messenger",
  color: "#c026d3",
  glyph: "ر",
  description: "ارسال پیام، عکس، فایل و موقعیت، و دریافت پیام‌ها با Bot API روبیکا",
  docsUrl: "https://rubika.ir/botapi",
  fields: [
    { key: "token", label: "توکن ربات", type: "secret", required: true, help: "از @BotFather در روبیکا بگیرید" },
    {
      key: "baseUrl",
      label: "آدرس پایه API",
      type: "url",
      default: "https://botapi.rubika.ir/v3",
      help: "آدرس قدیمی‌تر: https://messengerg2b1.iranlms.ir/v3",
    },
    { key: "defaultChatId", label: "چت پیش‌فرض", type: "text", placeholder: "اختیاری" },
  ],
  test: (ctx) => call(ctx, "getMe"),
  tools: [
    defineTool({
      name: "rubika_get_me",
      title: "اطلاعات ربات",
      description: "Get the Rubika bot's own profile.",
      input: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: (_a, ctx) => call(ctx, "getMe"),
    }),
    defineTool({
      name: "rubika_send_message",
      title: "ارسال پیام متنی",
      description: "Send a text message via the Rubika bot.",
      input: {
        chat_id: chatId,
        text: z.string().min(1).describe("Message text"),
        reply_to_message_id: z.string().optional().describe("Reply to this message id"),
      },
      annotations: { openWorldHint: true },
      handler: (a, ctx) =>
        call(ctx, "sendMessage", { chat_id: chatIdOf(ctx, a.chat_id), text: a.text, reply_to_message_id: a.reply_to_message_id }),
    }),
    defineTool({
      name: "rubika_send_photo",
      title: "ارسال عکس",
      description: "Send a photo via the Rubika bot, with optional caption.",
      input: {
        chat_id: chatId,
        photo: mediaField("image", "The image"),
        caption: z.string().optional().describe("Optional caption"),
        reply_to_message_id: z.string().optional(),
      },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const chat = chatIdOf(ctx, a.chat_id);
        const file_id = await uploadFile(ctx, a.photo, "Image", { expect: "image" });
        return call(ctx, "sendFile", { chat_id: chat, file_id, text: a.caption, reply_to_message_id: a.reply_to_message_id });
      },
    }),
    defineTool({
      name: "rubika_send_file",
      title: "ارسال فایل",
      description: "Send a file (document, video, music, voice, gif) via the Rubika bot, with optional caption.",
      input: {
        chat_id: chatId,
        file: mediaField("file", "The file"),
        type: z.enum(["File", "Video", "Gif", "Music", "Voice"]).optional().describe("How Rubika should treat the file. Default: File"),
        caption: z.string().optional().describe("Optional caption"),
        filename: z.string().optional().describe("Override the file name (extension matters)"),
      },
      annotations: { openWorldHint: true },
      handler: async (a, ctx) => {
        const chat = chatIdOf(ctx, a.chat_id);
        const file_id = await uploadFile(ctx, a.file, a.type ?? "File", { filename: a.filename });
        return call(ctx, "sendFile", { chat_id: chat, file_id, text: a.caption });
      },
    }),
    defineTool({
      name: "rubika_send_location",
      title: "ارسال موقعیت",
      description: "Send a map location via the Rubika bot.",
      input: {
        chat_id: chatId,
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      },
      annotations: { openWorldHint: true },
      handler: (a, ctx) =>
        call(ctx, "sendLocation", { chat_id: chatIdOf(ctx, a.chat_id), latitude: String(a.latitude), longitude: String(a.longitude) }),
    }),
    defineTool({
      name: "rubika_get_chat",
      title: "اطلاعات چت",
      description: "Get information about a Rubika chat.",
      input: { chat_id: chatId },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: (a, ctx) => call(ctx, "getChat", { chat_id: chatIdOf(ctx, a.chat_id) }),
    }),
    defineTool({
      name: "rubika_get_updates",
      title: "دریافت پیام‌های جدید",
      description: "Fetch recent updates (incoming messages) for the Rubika bot.",
      input: {
        limit: z.number().int().min(1).max(100).optional().describe("Max updates, default 20"),
        offset_id: z.string().optional().describe("Pagination cursor from a previous call (next_offset_id)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: (a, ctx) => call(ctx, "getUpdates", { limit: a.limit ?? 20, offset_id: a.offset_id }),
    }),
  ],
};
