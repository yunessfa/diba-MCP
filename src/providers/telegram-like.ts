import { z } from "zod";
import { request } from "../core/http.js";
import { isUploadable, loadMedia, mediaField } from "../core/media.js";
import { FormData } from "../core/net.js";
import { defineTool, ProviderError, type ProviderContext, type ProviderDef } from "../core/types.js";

/**
 * بله و سروش‌پلاس هر دو Bot API شبیه تلگرام دارند:
 *   {baseUrl}/bot{token}/{method}
 * این factory یک provider کامل برای هر دو می‌سازد.
 */
export interface TelegramLikeOptions {
  id: string;
  name: string;
  nameFa: string;
  color: string;
  glyph: string;
  defaultBaseUrl: string;
  docsUrl: string;
  botfather: string;
  description: string;
}

export function chatIdOf(ctx: ProviderContext, chatId?: string): string {
  const id = chatId?.trim() || ctx.config.defaultChatId;
  if (!id) throw new ProviderError("chat_id داده نشده و «چت پیش‌فرض» هم در تنظیمات خالی است");
  return id;
}

export function createTelegramLikeProvider(o: TelegramLikeOptions): ProviderDef {
  async function call(ctx: ProviderContext, method: string, params: Record<string, unknown> = {}, form?: FormData) {
    const { token, baseUrl } = ctx.config;
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== ""));
    const data = await request(`${baseUrl.replace(/\/+$/, "")}/bot${token}/${method}`, {
      ...(form ? { form, timeoutMs: 120_000 } : { json: clean }),
      secrets: [token],
    });
    if (data && data.ok === false) {
      throw new ProviderError(`${o.nameFa}: ${data.description ?? "خطای ناشناخته"}`, data);
    }
    return data?.result ?? data;
  }

  /**
   * ارسال رسانه: لینک و فایل انتخاب‌شده را خود سرور دانلود و به‌صورت multipart آپلود می‌کند
   * (پیام‌رسان لازم نیست به لینک دسترسی داشته باشد)؛ file_id بدون آپلود فرستاده می‌شود.
   */
  async function sendMedia(
    ctx: ProviderContext,
    method: string,
    field: string,
    value: string,
    params: Record<string, unknown>,
    opts: { expect?: "image"; filename?: string } = {},
  ) {
    if (!isUploadable(value)) return call(ctx, method, { ...params, [field]: value });
    const media = await loadMedia(value, opts);
    const form = new FormData();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") form.append(k, String(v));
    form.append(field, media.blob, media.filename);
    return call(ctx, method, {}, form);
  }

  const chatId = z.string().optional().describe("Chat/user/channel id. If omitted, the default chat from settings is used.");
  const p = o.id; // پیشوند نام ابزارها

  return {
    id: o.id,
    name: o.name,
    nameFa: o.nameFa,
    category: "messenger",
    color: o.color,
    glyph: o.glyph,
    description: o.description,
    docsUrl: o.docsUrl,
    fields: [
      { key: "token", label: "توکن ربات", type: "secret", required: true, placeholder: "123456:ABC...", help: `از ${o.botfather} بگیرید` },
      { key: "baseUrl", label: "آدرس پایه API", type: "url", default: o.defaultBaseUrl },
      { key: "defaultChatId", label: "چت پیش‌فرض", type: "text", placeholder: "اختیاری — شناسه کانال یا کاربر" },
    ],
    test: (ctx) => call(ctx, "getMe"),
    tools: [
      defineTool({
        name: `${p}_get_me`,
        title: "اطلاعات ربات",
        description: `Get the bot's own profile on ${o.name} messenger (id, username, name).`,
        input: {},
        annotations: { readOnlyHint: true, openWorldHint: true },
        handler: (_a, ctx) => call(ctx, "getMe"),
      }),
      defineTool({
        name: `${p}_send_message`,
        title: "ارسال پیام متنی",
        description: `Send a text message via the ${o.name} bot to a user, group or channel. Text supports Markdown.`,
        input: {
          chat_id: chatId,
          text: z.string().min(1).max(4096).describe("Message text (max 4096 chars)"),
          reply_to_message_id: z.number().int().optional().describe("Reply to this message id"),
        },
        annotations: { openWorldHint: true },
        handler: (a, ctx) =>
          call(ctx, "sendMessage", { chat_id: chatIdOf(ctx, a.chat_id), text: a.text, reply_to_message_id: a.reply_to_message_id }),
      }),
      defineTool({
        name: `${p}_send_photo`,
        title: "ارسال عکس",
        description: `Send a photo via the ${o.name} bot, with optional caption.`,
        input: {
          chat_id: chatId,
          photo: mediaField("image", "The image"),
          caption: z.string().max(1024).optional().describe("Optional caption"),
          reply_to_message_id: z.number().int().optional(),
        },
        annotations: { openWorldHint: true },
        handler: (a, ctx) =>
          sendMedia(ctx, "sendPhoto", "photo", a.photo, { chat_id: chatIdOf(ctx, a.chat_id), caption: a.caption, reply_to_message_id: a.reply_to_message_id }, { expect: "image" }),
      }),
      defineTool({
        name: `${p}_send_document`,
        title: "ارسال فایل",
        description: `Send any file (pdf, zip, video...) as a document via the ${o.name} bot, with optional caption. Max 20MB.`,
        input: {
          chat_id: chatId,
          document: mediaField("file", "The file"),
          caption: z.string().max(1024).optional().describe("Optional caption"),
          filename: z.string().optional().describe("Override the file name shown in chat (extension matters)"),
        },
        annotations: { openWorldHint: true },
        handler: (a, ctx) =>
          sendMedia(ctx, "sendDocument", "document", a.document, { chat_id: chatIdOf(ctx, a.chat_id), caption: a.caption }, { filename: a.filename }),
      }),
      defineTool({
        name: `${p}_get_chat`,
        title: "اطلاعات چت",
        description: `Get information about a chat/channel/user on ${o.name}.`,
        input: { chat_id: chatId },
        annotations: { readOnlyHint: true, openWorldHint: true },
        handler: (a, ctx) => call(ctx, "getChat", { chat_id: chatIdOf(ctx, a.chat_id) }),
      }),
      defineTool({
        name: `${p}_get_updates`,
        title: "دریافت پیام‌های جدید",
        description: `Fetch recent incoming updates (messages) for the ${o.name} bot via polling. Does not work while a webhook is set.`,
        input: {
          offset: z.number().int().optional().describe("Identifier of the first update to return"),
          limit: z.number().int().min(1).max(100).optional().describe("Max updates (1-100), default 20"),
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
        handler: (a, ctx) => call(ctx, "getUpdates", { offset: a.offset, limit: a.limit ?? 20, timeout: 0 }),
      }),
    ],
  };
}
