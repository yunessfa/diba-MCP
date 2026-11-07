import { createTelegramLikeProvider } from "./telegram-like.js";

export const soroush = createTelegramLikeProvider({
  id: "soroush",
  name: "Soroush Plus",
  nameFa: "سروش‌پلاس",
  color: "#3b82f6",
  glyph: "س",
  defaultBaseUrl: "https://api.splus.ir",
  docsUrl: "https://soroushplus.com/p/documents/bot-platform",
  botfather: "splus.ir/botfather",
  description: "ارسال پیام و عکس با Bot API رسمی سروش‌پلاس",
});
