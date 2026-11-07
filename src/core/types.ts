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

/** چیزی که هندلر هر ابزار در اختیار دارد */
export interface ProviderContext {
  /** مقادیر نهایی تنظیمات (env + فایل + پیش‌فرض) */
  config: Record<string, string>;
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
