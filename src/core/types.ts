import type { z } from "zod";

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

export interface IncomingMessage {
  key: string;
  provider: string;
  chatId: string;
  chatTitle?: string;
  chatType: "private" | "group" | "channel" | "unknown";
  messageId: string;
  from?: { id?: string; name?: string; username?: string };
  text?: string;
  kind: "text" | "photo" | "file" | "video" | "voice" | "location" | "button" | "other";
  buttonId?: string;
  date: string;
  direction?: "in" | "out";
  source?: "mcp" | "dashboard";
  mediaUrl?: string;
}

export interface PollResult {
  messages: IncomingMessage[];
  cursor?: string;
}

export interface ReceiveDef {
  poll: (ctx: ProviderContext, cursor: string | undefined, longPollSec: number) => Promise<PollResult>;
  idleMs?: number;
}

export interface InboxAccess {
  list: (opts?: { chatId?: string; limit?: number }) => IncomingMessage[];
}

export interface ProviderContext {
  config: Record<string, string>;
  inbox?: InboxAccess;
}

export interface ToolDef<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;
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
  color: string;
  glyph: string;
  description: string;
  docsUrl?: string;
  fields: ProviderField[];
  tools: ToolDef<any>[];
  test?: (ctx: ProviderContext) => Promise<unknown>;
  receive?: ReceiveDef;
  actions?: Record<string, { title: string; run: (ctx: ProviderContext) => Promise<unknown> }>;
}

export function defineTool<S extends z.ZodRawShape>(def: ToolDef<S>): ToolDef<S> {
  return def;
}

export class ProviderError extends Error {
  constructor(message: string, public readonly details?: unknown) {
    super(message);
    this.name = "ProviderError";
  }
}
