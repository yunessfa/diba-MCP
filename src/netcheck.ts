import { existsSync } from "node:fs";
import { printNetcheck } from "./server.js";

if (existsSync(".env")) process.loadEnvFile(".env");
process.exit((await printNetcheck()) ? 0 : 1);
