import type { z } from "zod";

/** یک فیلد تنظیمات برای هر سرویس (توکن، آدرس پایه و ...) */
export interface ProviderField {
  key: string;
  label: string;
  type: "text" | "secret" | "url";
  required?: boolean;
  placeholder?: string;
  help?: string;
  default?: string;
}

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** پیام دریافتی، به شکل یکسان برای همه‌ی پیام‌رسان‌ها */
export interface IncomingMessage {
  /** شناسه‌ی یکتا در صندوق: provider:chat:message */
  key: string;
  provider: string;
  chatId: string;
  chatTitle?: string;
  chatType: "private" | "group" | "channel" | "unknown";
  messageId: string;
  from?: { id?: string; name?: string; username?: string };
  /** متن پیام یا کپشن */
  text?: string;
  kind: "text" | "photo" | "file" | "video" | "voice" | "location" | "button" | "other";
  /** شناسه‌ی دکمه‌ای که کاربر زده (اگر این پیام کلیک دکمه باشد) */
  buttonId?: string;
  /** زمان پیام (ISO) */
  date: string;
}

export interface PollResult {
  messages: IncomingMessage[];
  /** نشانگر ادامه برای فراخوانی بعدی (offset) */
  cursor?: string;
}

/** دریافت پیام‌ها با polling */
export interface ReceiveDef {
  /** cursor قبلی را می‌گیرد و پیام‌های جدید را برمی‌گرداند. longPollSec: حداکثر انتظار سرور */
  poll: (ctx: ProviderContext, cursor: string | undefined, longPollSec: number) => Promise<PollResult>;
  /** فاصله‌ی بین pollهای خالی برای پیام‌رسان‌هایی که long-poll ندارند (میلی‌ثانیه) */
  idleMs?: number;
}

/** دسترسی ابزارها به صندوق پیام‌ها */
export interface InboxAccess {
  /** پیام‌های ذخیره‌شده، جدیدترین اول */
  list: (opts?: { chatId?: string; limit?: number }) => IncomingMessage[];
}

/** چیزی که هندلر هر ابزار در اختیار دارد */
export interface ProviderContext {
  /** مقادیر نهایی تنظیمات (env + فایل + پیش‌فرض) */
  config: Record<string, string>;
  /** وقتی «دریافت پیام‌ها» برای این سرویس روشن است */
  inbox?: InboxAccess;
}

export interface ToolDef<S extends z.ZodRawShape = z.ZodRawShape> {
  /** نام یکتا، مثل bale_send_message */
  name: string;
  /** عنوان فارسی برای داشبورد */
  title: string;
  /** توضیح برای مدل (انگلیسی/فارسی) */
  description: string;
  input: S;
  annotations?: ToolAnnotations;
  handler: (args: z.infer<z.ZodObject<S>>, ctx: ProviderContext) => Promise<unknown>;
}

export type Category = "messenger" | "payment" | "sms" | "map" | "utility";

export interface ProviderDef {
  id: string;
  name: string;
  nameFa: string;
  category: Category;
  /** رنگ شاخص برای داشبورد */
  color: string;
  /** حرف نمایشی در آیکن */
  glyph: string;
  description: string;
  docsUrl?: string;
  fields: ProviderField[];
  tools: ToolDef<any>[];
  /** تست اتصال (معمولاً getMe) */
  test?: (ctx: ProviderContext) => Promise<unknown>;
  /** دریافت پیام‌های ورودی (اگر پیام‌رسان پشتیبانی کند) */
  receive?: ReceiveDef;
  /** کارهای مدیریتی که فقط از داشبورد اجرا می‌شوند (به مدل داده نمی‌شوند) */
  actions?: Record<string, { title: string; run: (ctx: ProviderContext) => Promise<unknown> }>;
}

/** کمک‌تابع برای اینکه تایپ args داخل handler درست استنتاج شود */
export function defineTool<S extends z.ZodRawShape>(def: ToolDef<S>): ToolDef<S> {
  return def;
}

export class ProviderError extends Error {
  constructor(message: string, public readonly details?: unknown) {
    super(message);
    this.name = "ProviderError";
  }
}
