import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProviderDef } from "./types.js";

export interface ProviderState {
  enabled: boolean;
  values: Record<string, string>;
}

export interface StoredConfig {
  version: 1;
  mcpToken: string;
  admin?: { salt: string; hash: string };
  providers: Record<string, ProviderState>;
}

/** نام متغیر محیطی برای هر فیلد: BALE_TOKEN ، RUBIKA_BASE_URL ، ... */
export function envKey(providerId: string, fieldKey: string): string {
  const snake = fieldKey.replace(/([a-z0-9])([A-Z])/g, "$1_$2");
  return `${providerId}_${snake}`.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

/**
 * ذخیره‌سازی تنظیمات در یک فایل JSON (data/config.json).
 * مقادیر env همیشه بر مقادیر فایل اولویت دارند.
 */
export class ConfigStore {
  private data: StoredConfig;
  private file: string;

  constructor(private dataDir: string, private env: NodeJS.ProcessEnv = process.env) {
    this.file = join(dataDir, "config.json");
    mkdirSync(dataDir, { recursive: true });
    this.data = this.load();
  }

  private load(): StoredConfig {
    if (existsSync(this.file)) {
      try {
        const parsed = JSON.parse(readFileSync(this.file, "utf8"));
        return { version: 1, providers: {}, mcpToken: "", ...parsed };
      } catch (err) {
        console.error("[iran-mcp] config.json خراب است؛ یک فایل جدید ساخته می‌شود", err);
      }
    }
    const fresh: StoredConfig = { version: 1, mcpToken: newToken(), providers: {} };
    this.data = fresh;
    this.persist();
    return fresh;
  }

  private persist() {
    const tmp = this.file + ".tmp";
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  // ---------- توکن MCP ----------
  get mcpToken(): string {
    return this.env.MCP_TOKEN || this.data.mcpToken;
  }
  get mcpTokenFromEnv(): boolean {
    return Boolean(this.env.MCP_TOKEN);
  }
  rotateMcpToken(): string {
    this.data.mcpToken = newToken();
    this.persist();
    return this.data.mcpToken;
  }

  // ---------- ادمین ----------
  get admin() {
    return this.data.admin;
  }
  setAdmin(admin: { salt: string; hash: string }) {
    this.data.admin = admin;
    this.persist();
  }

  // ---------- سرویس‌ها ----------
  state(id: string): ProviderState {
    return this.data.providers[id] ?? { enabled: false, values: {} };
  }

  /** مقدار نهایی هر فیلد + اینکه از env آمده یا نه */
  resolve(def: ProviderDef): { values: Record<string, string>; fromEnv: Record<string, boolean> } {
    const st = this.state(def.id);
    const values: Record<string, string> = {};
    const fromEnv: Record<string, boolean> = {};
    for (const f of def.fields) {
      const e = this.env[envKey(def.id, f.key)];
      if (e) {
        values[f.key] = e;
        fromEnv[f.key] = true;
      } else {
        values[f.key] = st.values[f.key] || f.default || "";
        fromEnv[f.key] = false;
      }
    }
    return { values, fromEnv };
  }

  isEnabled(def: ProviderDef): boolean {
    const envFlag = this.env[`${def.id.toUpperCase()}_ENABLED`];
    if (envFlag !== undefined) return envFlag === "true" || envFlag === "1";
    return this.state(def.id).enabled;
  }

  missingFields(def: ProviderDef): string[] {
    const { values } = this.resolve(def);
    return def.fields.filter((f) => f.required && !values[f.key]).map((f) => f.key);
  }

  isReady(def: ProviderDef): boolean {
    return this.isEnabled(def) && this.missingFields(def).length === 0;
  }

  update(id: string, patch: { enabled?: boolean; values?: Record<string, string> }) {
    const cur = this.state(id);
    const next: ProviderState = { enabled: patch.enabled ?? cur.enabled, values: { ...cur.values } };
    for (const [k, v] of Object.entries(patch.values ?? {})) {
      if (v === "") delete next.values[k];
      else next.values[k] = v.trim();
    }
    this.data.providers[id] = next;
    this.persist();
  }
}

export function newToken(): string {
  return "imcp_" + randomBytes(24).toString("base64url");
}
