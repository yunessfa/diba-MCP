import { z } from "zod";
import { request } from "../core/http.js";
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

const chatId = z.string().optional().describe("Rubika chat_id (e.g. b0QF...). If omitted, the default chat from settings is used.");

export const rubika: ProviderDef = {
  id: "rubika",
  name: "Rubika",
  nameFa: "روبیکا",
  category: "messenger",
  color: "#c026d3",
  glyph: "ر",
  description: "ارسال پیام، موقعیت و دریافت پیام‌ها با Bot API روبیکا",
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
