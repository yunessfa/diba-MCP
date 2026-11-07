import type { ProviderDef } from "../core/types.js";
import { bale } from "./bale.js";
import { eitaa } from "./eitaa.js";
import { rubika } from "./rubika.js";
import { soroush } from "./soroush.js";

/**
 * فهرست همه‌ی سرویس‌ها.
 * برای اضافه کردن سرویس جدید (زرین‌پال، کاوه‌نگار، نشان، ...):
 *   ۱. یک فایل در همین پوشه بسازید که ProviderDef برگرداند
 *   ۲. اینجا به آرایه اضافه‌اش کنید
 */
export const builtinProviders: ProviderDef[] = [bale, eitaa, rubika, soroush];

export { bale, eitaa, rubika, soroush };
