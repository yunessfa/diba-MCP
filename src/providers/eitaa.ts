import { z } from "zod";
import { request } from "../core/http.js";
import { isUploadable, loadMedia, mediaField } from "../core/media.js";
import { FormData } from "../core/net.js";
import { defineTool, ProviderError, type ProviderContext, type ProviderDef } from "../core/types.js";
import { chatIdOf } from "./telegram-like.js";

async function call(ctx: ProviderContext, method: string, form?: FormData, timeoutMs?: number) {
  const { token, baseUrl } = ctx.config;
  const data = await request(`${baseUrl.replace(/\/+$/, "")}/${token}/${method}`, { form, timeoutMs, secrets: [token] });
  if (data && data.ok === false) {
    throw new ProviderError(`ایتا: ${data.description ?? "خطای ناشناخته"}`, data);
  }
  return data?.result ?? data;
}

function formOf(obj: Record<string, unknown>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === "" || v === false) continue;
    f.append(k, v === true ? "1" : String(v));
  }
  return f;
}

async function sendFile(ctx: ProviderContext, value: string, fields: Record<string, unknown>, opts: { expect?: "image"; filename?: string } = {}) {
  if (!isUploadable(value)) throw new ProviderError("ایتا فقط لینک فایل یا فایل انتخاب‌شده را قبول می‌کند (file_id پشتیبانی نمی‌شود)");
  const media = await loadMedia(value, opts);
  const f = formOf(fields);
  f.append("file", media.blob, media.filename);
  return call(ctx, "sendFile", f, 120_000);
}

const chatId = z.string().optional().describe("Channel/group id or username without @. If omitted, the default chat from settings is used.");

export const eitaa: ProviderDef = {
  id: "eitaa",
  name: "Eitaa",
  nameFa: "ایتا",
  category: "messenger",
  color: "#f08a24",
  glyph: "ا",
  description: "ارسال پیام، عکس و فایل به کانال‌ها و گروه‌های ایتا از طریق ایتایار",
  docsUrl: "https://eitaayar.ir/",
  fields: [
    { key: "token", label: "توکن ایتایار", type: "secret", required: true, placeholder: "bot12345:xxxxxxxx-xxxx-...", help: "از پنل eitaayar.ir بگیرید" },
    { key: "baseUrl", label: "آدرس پایه API", type: "url", default: "https://eitaayar.ir/api" },
    { key: "defaultChatId", label: "کانال پیش‌فرض", type: "text", placeholder: "شناسه یا نام کاربری کانال" },
  ],
  test: (ctx) => call(ctx, "getMe"),
  tools: [
    defineTool({
      name: "eitaa_get_me",
      title: "اطلاعات ربات",
      description: "Get info about the Eitaayar bot/token.",
      input: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: (_a, ctx) => call(ctx, "getMe"),
    }),
    defineTool({
      name: "eitaa_send_message",
      title: "ارسال پیام به کانال/گروه",
      description:
        "Send a text message to an Eitaa channel or group (Eitaayar only supports channels/groups, not private chats). Supports silent send, pin, scheduling and auto-delete by view count.",
      input: {
        chat_id: chatId,
        text: z.string().min(1).describe("Message text"),
        title: z.string().optional().describe("Internal title for search/listing"),
        disable_notification: z.boolean().optional().describe("Send silently"),
        reply_to_message_id: z.number().int().optional(),
        pin: z.boolean().optional().describe("Pin the message after sending"),
        date: z.number().int().optional().describe("Unix timestamp for scheduled sending"),
        viewCountForDelete: z.number().int().optional().describe("Delete after this many views"),
      },
      annotations: { openWorldHint: true },
      handler: (a, ctx) => call(ctx, "sendMessage", formOf({ ...a, chat_id: chatIdOf(ctx, a.chat_id) })),
    }),
    defineTool({
      name: "eitaa_send_photo",
      title: "ارسال عکس",
      description: "Send a photo to an Eitaa channel/group with an optional caption (max 20MB).",
      input: {
        chat_id: chatId,
        photo: mediaField("image", "The image (file_id is not supported by Eitaayar)"),
        caption: z.string().optional(),
      },
      annotations: { openWorldHint: true },
      handler: (a, ctx) => sendFile(ctx, a.photo, { chat_id: chatIdOf(ctx, a.chat_id), caption: a.caption }, { expect: "image" }),
    }),
    defineTool({
      name: "eitaa_send_file",
      title: "ارسال فایل",
      description:
        "Send any file to an Eitaa channel/group with an optional caption (max 20MB). Use .gif extension for GIFs and .webp for stickers.",
      input: {
        chat_id: chatId,
        file: mediaField("file", "The file (file_id is not supported by Eitaayar)"),
        caption: z.string().optional(),
        filename: z.string().optional().describe("Override file name (extension matters)"),
      },
      annotations: { openWorldHint: true },
      handler: (a, ctx) => sendFile(ctx, a.file, { chat_id: chatIdOf(ctx, a.chat_id), caption: a.caption }, { filename: a.filename }),
    }),
  ],
};
