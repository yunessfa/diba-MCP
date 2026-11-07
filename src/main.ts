/** اجرای مستقل: داشبورد + اندپوینت MCP روی HTTP */
import { existsSync } from "node:fs";
import express from "express";
import { createDibaMcp } from "./index.js";

if (existsSync(".env")) process.loadEnvFile(".env");

const PORT = Number(process.env.PORT ?? 3790);
const HOST = process.env.HOST ?? "127.0.0.1";

const dibaMcp = createDibaMcp();
const app = express();
app.disable("x-powered-by");
if (process.env.TRUST_PROXY) app.set("trust proxy", process.env.TRUST_PROXY);

app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.use("/", dibaMcp.router());

app.listen(PORT, HOST, () => {
  const base = `http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`;
  console.error(`[diba-mcp] داشبورد:   ${base}/`);
  console.error(`[diba-mcp] اندپوینت MCP: ${base}/mcp`);
});
