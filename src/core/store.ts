import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProviderDef } from "./types.js";

export interface ProviderState {
  enabled: boolean;
  receive?: boolean;
  values: Record<string, string>;
}

export interface StoredConfig {
  version: 1;
  mcpToken: string;
  admin?: { salt: string; hash: string };
  sessionSecret: string;
  sessionEpoch: number;
  providers: Record<string, ProviderState>;
}

export function envKey(providerId: string, fieldKey: string): string {
  const snake = fieldKey.replace(/([a-z0-9])([A-Z])/g, "$1_$2");
  return `${providerId}_${snake}`.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

export class ConfigStore {
  private data: StoredConfig;
  private file: string;

  constructor(private dataDir: string, private env: NodeJS.ProcessEnv = process.env) {
    this.file = join(dataDir, "config.json");
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.data = this.load();
  }

  private load(): StoredConfig {
    const defaults = (): StoredConfig => ({
      version: 1,
      mcpToken: newToken(),
      sessionSecret: randomBytes(32).toString("base64url"),
      sessionEpoch: 0,
      providers: {},
    });
    if (existsSync(this.file)) {
      try {
        const parsed = JSON.parse(readFileSync(this.file, "utf8"));
        const merged: StoredConfig = { ...defaults(), ...parsed };
        if (!merged.mcpToken) merged.mcpToken = newToken();
        if (!parsed.sessionSecret || !parsed.mcpToken) {
          this.data = merged;
          this.persist();
        }
        return merged;
      } catch (err) {
        const backup = `${this.file}.corrupt-${Date.now()}`;
        copyFileSync(this.file, backup);
        console.error(`[diba-mcp] config.json خراب بود؛ نسخه‌ی خراب در ${backup} ذخیره شد و فایل تازه ساخته شد`, err);
      }
    }
    this.data = defaults();
    this.persist();
    return this.data;
  }

  private persist() {
    const tmp = this.file + ".tmp";
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
  }

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

  get admin() {
    return this.data.admin;
  }
  setAdmin(admin: { salt: string; hash: string }) {
    this.data.admin = admin;
    this.data.sessionEpoch++;
    this.persist();
  }

  clearAdmin() {
    delete this.data.admin;
    this.data.sessionEpoch++;
    this.persist();
  }

  get sessionSecret(): string {
    return this.data.sessionSecret;
  }
  get sessionEpoch(): number {
    return this.data.sessionEpoch;
  }
  bumpSessionEpoch() {
    this.data.sessionEpoch++;
    this.persist();
  }

  state(id: string): ProviderState {
    return this.data.providers[id] ?? { enabled: false, values: {} };
  }

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

  isReceiving(def: ProviderDef): boolean {
    const envFlag = this.env[`${def.id.toUpperCase()}_RECEIVE`];
    if (envFlag !== undefined) return envFlag === "true" || envFlag === "1";
    return Boolean(this.state(def.id).receive);
  }
  receiveFromEnv(def: ProviderDef): boolean {
    return this.env[`${def.id.toUpperCase()}_RECEIVE`] !== undefined;
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

  update(id: string, patch: { enabled?: boolean; receive?: boolean; values?: Record<string, string> }) {
    const cur = this.state(id);
    const next: ProviderState = {
      enabled: patch.enabled ?? cur.enabled,
      receive: patch.receive ?? cur.receive,
      values: { ...cur.values },
    };
    for (const [k, v] of Object.entries(patch.values ?? {})) {
      if (v === "") delete next.values[k];
      else next.values[k] = v.trim();
    }
    this.data.providers[id] = next;
    this.persist();
  }
}

export function newToken(): string {
  return "dmcp_" + randomBytes(24).toString("base64url");
}
