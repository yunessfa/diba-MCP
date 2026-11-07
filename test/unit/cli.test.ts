import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";

const cli = (args: string[], env: Record<string, string> = {}) =>
  spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env, DATA_DIR: "" },
    cwd: process.cwd(),
  });

describe("diba-mcp CLI", () => {
  test("--version prints package version", () => {
    const r = cli(["--version"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+/);
  });

  test("--help lists commands", () => {
    const r = cli(["--help"]);
    assert.equal(r.status, 0);
    for (const c of ["stdio", "netcheck", "token", "reset-password", "--port", "--data"]) assert.ok(r.stdout.includes(c), c);
  });

  test("unknown command and bad port exit with code 2", () => {
    assert.equal(cli(["nope"]).status, 2);
    assert.equal(cli(["--port", "70000"]).status, 2);
    assert.equal(cli(["--wat"]).status, 2);
  });

  test("token is stable for a data dir, reset-password works", () => {
    const d = mkdtempSync(join(tmpdir(), "diba-cli-"));
    const a = cli(["token", "--data", d]).stdout.trim();
    const b = cli(["token", "--data", d]).stdout.trim();
    assert.match(a, /^dmcp_/);
    assert.equal(a, b);
    assert.equal(cli(["reset-password", "--data", d]).status, 0);
  });
});
