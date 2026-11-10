import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { ConfigStore, envKey } from "../../src/core/store.ts";
import { bale, rubika } from "../../src/providers/index.ts";

const dir = () => mkdtempSync(join(tmpdir(), "diba-store-"));

describe("envKey", () => {
  test("camelCase field names become SNAKE env names", () => {
    assert.equal(envKey("bale", "token"), "BALE_TOKEN");
    assert.equal(envKey("rubika", "baseUrl"), "RUBIKA_BASE_URL");
    assert.equal(envKey("eitaa", "defaultChatId"), "EITAA_DEFAULT_CHAT_ID");
  });
});

describe("ConfigStore", () => {
  test("creates config with a token, session secret and 600 permissions", () => {
    const d = dir();
    const s = new ConfigStore(d, {});
    assert.match(s.mcpToken, /^dmcp_/);
    assert.ok(s.sessionSecret.length >= 32);
    assert.equal(statSync(join(d, "config.json")).mode & 0o777, 0o600);
  });

  test("values persist across instances", () => {
    const d = dir();
    new ConfigStore(d, {}).update("bale", { enabled: true, values: { token: "  abc:def  " } });
    const s2 = new ConfigStore(d, {});
    assert.equal(s2.resolve(bale).values.token, "abc:def");
    assert.equal(s2.isReady(bale), true);
  });

  test("env overrides file and is reported as fromEnv", () => {
    const d = dir();
    const s = new ConfigStore(d, { BALE_TOKEN: "from-env", BALE_ENABLED: "true" });
    s.update("bale", { enabled: false, values: { token: "from-file" } });
    const r = s.resolve(bale);
    assert.equal(r.values.token, "from-env");
    assert.equal(r.fromEnv.token, true);
    assert.equal(s.isEnabled(bale), true);
  });

  test("defaults fill empty fields, missing required fields block readiness", () => {
    const s = new ConfigStore(dir(), {});
    s.update("rubika", { enabled: true });
    assert.equal(s.resolve(rubika).values.baseUrl, "https://botapi.rubika.ir/v3");
    assert.deepEqual(s.missingFields(rubika), ["token"]);
    assert.equal(s.isReady(rubika), false);
  });

  test("empty string clears a stored value", () => {
    const s = new ConfigStore(dir(), {});
    s.update("bale", { values: { token: "x" } });
    s.update("bale", { values: { token: "" } });
    assert.equal(s.resolve(bale).values.token, "");
  });

  test("corrupt config is backed up instead of silently lost", () => {
    const d = dir();
    writeFileSync(join(d, "config.json"), "{ not json");
    const s = new ConfigStore(d, {});
    assert.match(s.mcpToken, /^dmcp_/);
    const backups = readdirSync(d).filter((f) => f.startsWith("config.json.corrupt-"));
    assert.equal(backups.length, 1);
    assert.equal(readFileSync(join(d, backups[0]), "utf8"), "{ not json");
  });

  test("old config without session fields is upgraded in place", () => {
    const d = dir();
    writeFileSync(join(d, "config.json"), JSON.stringify({ version: 1, mcpToken: "imcp_old", providers: {} }));
    const s = new ConfigStore(d, {});
    assert.equal(s.mcpToken, "imcp_old");
    assert.ok(s.sessionSecret);
    assert.ok(JSON.parse(readFileSync(join(d, "config.json"), "utf8")).sessionSecret);
  });

  test("rotating the token and setting admin bump state correctly", () => {
    const s = new ConfigStore(dir(), {});
    const t = s.mcpToken;
    assert.notEqual(s.rotateMcpToken(), t);
    const e = s.sessionEpoch;
    s.setAdmin({ salt: "a", hash: "b" });
    assert.equal(s.sessionEpoch, e + 1);
  });

  test("MCP_TOKEN in env wins and cannot be rotated away", () => {
    const s = new ConfigStore(dir(), { MCP_TOKEN: "env-token" });
    assert.equal(s.mcpToken, "env-token");
    assert.equal(s.mcpTokenFromEnv, true);
    assert.equal(existsSync(s["file" as never]), true);
  });
});
