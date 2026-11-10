import type { DibaMcpEngine } from "./engine.js";
import { proxyMode } from "./net.js";
import { probe } from "./netcheck.js";
import { testImageDataUrl } from "./testimage.js";

export type StepStatus = "ok" | "fail" | "skip";

export interface SelfTestStep {
  id: string;
  title: string;
  status: StepStatus;
  ms: number;
  detail?: string;
  hint?: string;
  result?: unknown;
}

export interface SelfTestReport {
  provider: string;
  providerName: string;
  version: string;
  startedAt: string;
  proxy: string;
  sent: boolean;
  chatId?: string;
  steps: SelfTestStep[];
  ok: boolean;
  text: string;
}

export function hintFor(error: string, step: string): string | undefined {
  const e = error.toLowerCase();
  if (/webhook/.test(e)) return "روی این ربات وبهوک تنظیم شده و تا وقتی هست، دریافت پیام کار نمی‌کند. از صفحه‌ی «پیام‌ها» دکمه‌ی «حذف وبهوک» را بزنید.";
  if (/conflict|terminated by other getupdates/.test(e)) return "برنامه‌ی دیگری هم همزمان پیام‌های این ربات را می‌خواند. فقط یکی از آن‌ها باید روشن باشد.";
  if (/پراکسی/.test(error)) return "تنظیمات SOCKS_PROXY یا HTTPS_PROXY را بررسی کنید.";
  if (/dns|enotfound|eai_again/.test(e)) return "آدرس API پیدا نشد. آدرس پایه را در تنظیمات و DNS سرور را بررسی کنید.";
  if (/محدودیت ip|timeout|زمان/.test(e)) return "سرور به API پیام‌رسان نمی‌رسد. اگر سرور خارج از ایران است، پراکسی به یک سرور ایران تنظیم کنید (DEPLOY.md، «مسیر ب»).";
  if (/econnrefused|اتصال رد شد/.test(e)) return "سرور مقصد اتصال را رد کرد. آدرس پایه را بررسی کنید.";
  if (/401|unauthorized|invalid_access|invalid token|توکن/.test(e)) return "توکن اشتباه است یا باطل شده. توکن را دوباره از BotFather همان پیام‌رسان بگیرید و ذخیره کنید.";
  if (/chat not found|chat_not_found|invalid_input|bad chat|peer|not found/.test(e) && step !== "auth")
    return "شناسه‌ی چت اشتباه است، یا کاربر هنوز ربات را استارت نکرده، یا ربات عضو آن گروه/کانال نیست.";
  if (/403|forbidden|blocked|kicked|not enough rights|not a member|admin/.test(e))
    return "ربات اجازه‌ی ارسال ندارد: کاربر ربات را بلاک کرده یا ربات در آن کانال/گروه ادمین نیست.";
  if (/404|not found/.test(e) && step === "auth") return "آدرس پایه‌ی API اشتباه است یا این متد را ندارد. مقدار پیش‌فرض را امتحان کنید.";
  if (/عکس نیست|مگابایت/.test(error)) return undefined;
  if (/http 5\d\d/.test(e)) return "سرور پیام‌رسان خطای داخلی داد. چند دقیقه بعد دوباره امتحان کنید.";
  return undefined;
}

function summarize(v: unknown): string | undefined {
  if (!v || typeof v !== "object") return v === undefined ? undefined : String(v);
  const o: any = (v as any).bot ?? v;
  const name = o.first_name ?? o.bot_title ?? o.title ?? o.name;
  const ltr = (t: string) => `\u2066${t}\u2069`;
  const user = o.username ? ltr(`@${o.username}`) : undefined;
  const id = o.id ?? o.bot_id;
  return [name, user, id !== undefined ? ltr(`id ${id}`) : undefined].filter(Boolean).join(" — ") || undefined;
}

export async function runSelfTest(
  engine: DibaMcpEngine,
  providerId: string,
  opts: { send?: boolean; chatId?: string } = {},
): Promise<SelfTestReport> {
  const p = engine.provider(providerId);
  if (!p) throw new Error("سرویس پیدا نشد");
  const steps: SelfTestStep[] = [];
  const startedAt = new Date().toISOString();
  const cfg = engine.store.resolve(p).values;
  const chatId = opts.chatId?.trim() || cfg.defaultChatId || undefined;
  const has = (suffix: string) => p.tools.some((t) => t.name === `${p.id}_${suffix}`);
  let blocked: string | undefined;

  const step = async (id: string, title: string, run: () => Promise<{ status?: StepStatus; detail?: string; result?: unknown }>) => {
    if (blocked) {
      steps.push({ id, title, status: "skip", ms: 0, detail: `به خاطر خطای «${blocked}» اجرا نشد` });
      return;
    }
    const t0 = performance.now();
    try {
      const r = await run();
      steps.push({ id, title, status: r.status ?? "ok", ms: Math.round(performance.now() - t0), detail: r.detail, result: r.result });
    } catch (err: any) {
      const detail = String(err?.message ?? err);
      steps.push({ id, title, status: "fail", ms: Math.round(performance.now() - t0), detail, hint: hintFor(detail, id) });
      if (id === "config" || id === "network" || id === "auth") blocked = title;
    }
  };
  const tool = async (name: string, args: Record<string, unknown>) => {
    const r = await engine.callTool(name, args, "dashboard");
    if (!r.ok) throw new Error(r.error);
    return r.result;
  };
  const skip = (detail: string) => ({ status: "skip" as const, detail });

  await step("config", "تنظیمات", async () => {
    const missing = engine.store.missingFields(p);
    if (missing.length) throw new Error(`این فیلدها خالی است: ${missing.join("، ")}`);
    if (!engine.store.isEnabled(p)) throw new Error("سرویس خاموش است؛ اول روشنش کنید");
    return { detail: chatId ? `چت آزمایش: \u2066${chatId}\u2069` : "چت پیش‌فرض تعیین نشده" };
  });

  await step("network", "دسترسی شبکه به API", async () => {
    const r = await probe(cfg.baseUrl, 10_000);
    if (!r.reachable) throw new Error(r.error);
    return { detail: `HTTP ${r.status}` };
  });

  await step("auth", "توکن و اطلاعات ربات", async () => {
    const r = await engine.testProvider(p.id);
    if (!r.ok) throw new Error(r.error);
    return { detail: summarize(r.result), result: r.result };
  });

  await step("chat", "دسترسی به چت", async () => {
    if (!chatId) return skip("چت پیش‌فرض ندارد. از صفحه‌ی «پیام‌ها» یکی را انتخاب کنید یا شناسه را دستی بدهید.");
    if (!has("get_chat")) return skip(`${p.nameFa} ابزار اطلاعات چت ندارد`);
    return { detail: summarize(await tool(`${p.id}_get_chat`, { chat_id: chatId })) };
  });

  await step("send_text", "ارسال پیام متنی", async () => {
    if (!opts.send) return skip("ارسال واقعی خاموش بود");
    if (!chatId) return skip("چت مقصد مشخص نیست");
    const time = new Date().toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" });
    await tool(`${p.id}_send_message`, { chat_id: chatId, text: `✅ پیام آزمایشی dibaMCP — ${time}` });
    return { detail: "ارسال شد؛ در پیام‌رسان چک کنید" };
  });

  await step("send_photo", "ارسال عکس", async () => {
    if (!opts.send) return skip("ارسال واقعی خاموش بود");
    if (!chatId) return skip("چت مقصد مشخص نیست");
    if (!has("send_photo")) return skip(`${p.nameFa} ابزار ارسال عکس ندارد`);
    await tool(`${p.id}_send_photo`, { chat_id: chatId, photo: testImageDataUrl(), caption: "عکس آزمایشی dibaMCP" });
    return { detail: "ارسال شد" };
  });

  await step("receive", "دریافت پیام‌ها", async () => {
    if (!p.receive) return skip(`${p.nameFa} (از این راه) دریافت پیام را پشتیبانی نمی‌کند`);
    const st = engine.inbox.statuses().find((s) => s.provider === p.id)!;
    if (st.running) {
      if (st.lastError) throw new Error(st.lastError);
      return { detail: `دریافت خودکار روشن است؛ ${st.received} پیام جدید از آخرین شروع` };
    }
    const { added } = await engine.inbox.fetchOnce(p.id);
    return { detail: added ? `${added} پیام جدید دریافت شد (در صفحه‌ی «پیام‌ها»)` : "کار می‌کند؛ پیام جدیدی نبود. یک پیام به ربات بدهید و دوباره امتحان کنید." };
  });

  const ok = steps.every((s) => s.status !== "fail");
  const mode = proxyMode();
  const proxy = mode.type === "direct" ? "مستقیم" : `${mode.type} (${mode.target})`;
  const icon = { ok: "✅", fail: "❌", skip: "⏭" } as const;
  const text = [
    `dibaMCP v${engine.version} — تست کامل ${p.nameFa}`,
    `زمان: ${startedAt}  |  شبکه: ${proxy}  |  ارسال واقعی: ${opts.send ? "بله" : "خیر"}`,
    "",
    ...steps.map((s) =>
      [`${icon[s.status]} ${s.title}${s.ms ? ` (${s.ms}ms)` : ""}${s.detail ? ` — ${s.detail}` : ""}`, s.hint ? `   راهنما: ${s.hint}` : ""]
        .filter(Boolean)
        .join("\n"),
    ),
  ].join("\n");

  return { provider: p.id, providerName: p.nameFa, version: engine.version, startedAt, proxy, sent: Boolean(opts.send), chatId, steps, ok, text };
}
