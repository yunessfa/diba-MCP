import { z } from "zod";
import { request } from "../core/http.js";
import { isUploadable, loadMedia, mediaField } from "../core/media.js";
import { FormData } from "../core/net.js";
import { defineTool, ProviderError, type IncomingMessage, type ProviderContext, type ProviderDef } from "../core/types.js";

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

const isoDate = (unix: unknown) => new Date(typeof unix === "number" ? unix * 1000 : Date.now()).toISOString();

function chatTypeOf(t?: string): IncomingMessage["chatType"] {
  if (t === "private") return "private";
  if (t === "group" || t === "supergroup") return "group";
  if (t === "channel") return "channel";
  return "unknown";
}

function displayName(x: any): string | undefined {
  if (!x) return undefined;
  const n = [x.first_name, x.last_name].filter(Boolean).join(" ");
  return x.title || n || (x.username ? `@${x.username}` : undefined);
}

/** یک update به سبک تلگرام (بله، سروش) را به پیام یکسان تبدیل می‌کند */
export function normalizeTelegramUpdate(provider: string, u: any): IncomingMessage | null {
  if (!u || typeof u !== "object") return null;
  const cb = u.callback_query;
  const m = cb?.message ?? u.message ?? u.channel_post ?? u.edited_message ?? u.edited_channel_post;
  if (!m?.chat || m.chat.id === undefined) return null;
  const from = cb?.from ?? m.from;
  const kind: IncomingMessage["kind"] = cb
    ? "button"
    : m.photo
      ? "photo"
      : m.video
        ? "video"
        : m.voice || m.audio
          ? "voice"
          : m.document
            ? "file"
            : m.location
              ? "location"
              : m.text !== undefined
                ? "text"
                : "other";
  return {
    key: `${provider}:${m.chat.id}:${cb ? `cb${cb.id}` : m.message_id}`,
    provider,
    chatId: String(m.chat.id),
    chatTitle: displayName(m.chat),
    chatType: chatTypeOf(m.chat.type),
    messageId: String(m.message_id ?? ""),
    from: from ? { id: from.id !== undefined ? String(from.id) : undefined, name: displayName(from), username: from.username } : undefined,
    text: cb ? cb.data : (m.text ?? m.caption),
    kind,
    buttonId: cb?.data,
    date: isoDate(cb ? undefined : m.date),
  };
}

export function createTelegramLikeProvider(o: TelegramLikeOptions): ProviderDef {
  async function call(
    ctx: ProviderContext,
    method: string,
    params: Record<string, unknown> = {},
    opts: { form?: FormData; timeoutMs?: number } = {},
  ) {
    const { token, baseUrl } = ctx.config;
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== ""));
    const data = await request(`${baseUrl.replace(/\/+$/, "")}/bot${token}/${method}`, {
      ...(opts.form ? { form: opts.form, timeoutMs: opts.timeoutMs ?? 120_000 } : { json: clean, timeoutMs: opts.timeoutMs }),
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
    return call(ctx, method, {}, { form });
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
    receive: {
      async poll(ctx, cursor, longPollSec) {
        const updates = await call(
          ctx,
          "getUpdates",
          { offset: cursor ? Number(cursor) : undefined, timeout: longPollSec, limit: 100 },
          { timeoutMs: (longPollSec + 15) * 1000 },
        );
        const list: any[] = Array.isArray(updates) ? updates : [];
        const maxId = list.reduce((m, u) => (typeof u.update_id === "number" && u.update_id > m ? u.update_id : m), -1);
        return {
          messages: list.map((u) => normalizeTelegramUpdate(o.id, u)).filter((m): m is IncomingMessage => Boolean(m)),
          cursor: maxId >= 0 ? String(maxId + 1) : cursor,
        };
      },
    },
    actions: {
      webhookInfo: { title: "وضعیت وبهوک", run: (ctx) => call(ctx, "getWebhookInfo") },
      deleteWebhook: { title: "حذف وبهوک", run: (ctx) => call(ctx, "deleteWebhook", { drop_pending_updates: false }) },
    },
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
        description:
          `Read recent messages in the ${o.name} bot's chats (newest first), with chat ids and sender names. Messages the bot itself sent have direction \"out\". ` +
          `Use it to find a chat_id or to see what users wrote.`,
        input: {
          chat_id: z.string().optional().describe("Only messages from this chat"),
          limit: z.number().int().min(1).max(100).optional().describe("Max messages (1-100), default 20"),
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
        handler: async (a, ctx) => {
          // وقتی «دریافت پیام‌ها» روشن است، فقط صندوق getUpdates را مصرف می‌کند
          if (ctx.inbox) return { source: "inbox", messages: ctx.inbox.list({ chatId: a.chat_id, limit: a.limit ?? 20 }) };
          const updates = await call(ctx, "getUpdates", { limit: 100, timeout: 0 });
          const messages = (Array.isArray(updates) ? updates : [])
            .map((u: any) => normalizeTelegramUpdate(o.id, u))
            .filter((m): m is IncomingMessage => Boolean(m) && (!a.chat_id || m!.chatId === a.chat_id))
            .reverse()
            .slice(0, a.limit ?? 20);
          return { source: "api", messages };
        },
      }),
    ],
  };
}
