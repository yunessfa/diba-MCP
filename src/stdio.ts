import { existsSync } from "node:fs";
import { startStdio } from "./server.js";

if (existsSync(".env")) process.loadEnvFile(".env");
await startStdio();
