import { createTelegramLikeProvider } from "./telegram-like.js";

export const bale = createTelegramLikeProvider({
  id: "bale",
  name: "Bale",
  nameFa: "بله",
  color: "#1fb486",
  glyph: "ب",
  defaultBaseUrl: "https://tapi.bale.ai",
  docsUrl: "https://docs.bale.ai/",
  botfather: "@botfather در بله",
  description: "ارسال پیام، عکس و دریافت پیام‌ها از طریق Bot API بله",
});
