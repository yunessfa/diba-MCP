import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { hashPassword, RateLimiter, safeEqual, SignedSessions, verifyPassword } from "../../src/core/auth.ts";

describe("password hashing", () => {
  test("correct password verifies, wrong one does not", () => {
    const h = hashPassword("s3cret-pass");
    assert.equal(verifyPassword("s3cret-pass", h), true);
    assert.equal(verifyPassword("s3cret-pasS", h), false);
    assert.equal(verifyPassword("", h), false);
  });

  test("same password gets a different salt each time", () => {
    assert.notEqual(hashPassword("x").hash, hashPassword("x").hash);
  });

  test("safeEqual handles different lengths", () => {
    assert.equal(safeEqual("abc", "abc"), true);
    assert.equal(safeEqual("abc", "abcd"), false);
  });
});

describe("SignedSessions", () => {
  let epoch = 0;
  const s = new SignedSessions(() => "secret-key", () => epoch, 1000);

  test("fresh token is valid", () => {
    assert.equal(s.valid(s.create()), true);
  });

  test("expired token is rejected", () => {
    const t = s.create(Date.now() - 5000);
    assert.equal(s.valid(t), false);
  });

  test("tampered payload or signature is rejected", () => {
    const [p, sig] = s.create().split(".");
    const forged = Buffer.from(JSON.stringify({ exp: Date.now() + 1e9, e: 0 })).toString("base64url");
    assert.equal(s.valid(`${forged}.${sig}`), false);
    assert.equal(s.valid(`${p}.${sig.slice(0, -2)}xx`), false);
    assert.equal(s.valid("garbage"), false);
    assert.equal(s.valid(undefined), false);
  });

  test("token signed with another secret is rejected", () => {
    const other = new SignedSessions(() => "other-key", () => epoch);
    assert.equal(s.valid(other.create()), false);
  });

  test("bumping the epoch logs everyone out", () => {
    const t = s.create();
    epoch++;
    assert.equal(s.valid(t), false);
    assert.equal(s.valid(s.create()), true);
  });
});

describe("RateLimiter", () => {
  test("allows up to max per window, then blocks, then resets", () => {
    const r = new RateLimiter(3, 1000);
    const t0 = 1_000_000;
    assert.deepEqual([1, 2, 3, 4].map(() => r.allow("ip", t0)), [true, true, true, false]);
    assert.ok(r.retryAfter("ip", t0) >= 1);
    assert.equal(r.allow("ip", t0 + 1001), true);
  });

  test("keys are independent", () => {
    const r = new RateLimiter(1, 1000);
    assert.equal(r.allow("a", 0), true);
    assert.equal(r.allow("b", 0), true);
    assert.equal(r.allow("a", 1), false);
  });
});
