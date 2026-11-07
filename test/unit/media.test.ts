import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { configureMedia, isUploadable, loadMedia, summarizeForLog } from "../../src/core/media.ts";
import { configureProxy } from "../../src/core/net.ts";

configureProxy({});

describe("media input", () => {
  test("isUploadable: links and data URLs upload, anything else is a file_id", () => {
    assert.equal(isUploadable("https://a.com/x.jpg"), true);
    assert.equal(isUploadable("data:image/png;base64,AAAA"), true);
    assert.equal(isUploadable("AgACAgQAAxkB"), false);
    assert.equal(isUploadable("ftp://a.com/x"), false);
  });

  test("data URL: name, mime and extension", async () => {
    const m = await loadMedia(`data:image/jpeg;name=${encodeURIComponent("پرتره")};base64,${Buffer.from("xyz").toString("base64")}`);
    assert.equal(m.filename, "پرتره.jpg");
    assert.equal(m.mime, "image/jpeg");
    assert.equal(m.blob.size, 3);
  });

  test("data URL: size limit, empty file, non-image rejected when an image is expected", async () => {
    const big = `data:image/png;base64,${Buffer.alloc(2048).toString("base64")}`;
    await assert.rejects(loadMedia(big, { max: 1024 }), /مگابایت/);
    await assert.rejects(loadMedia("data:image/png;base64,"), /خالی/);
    await assert.rejects(loadMedia(`data:application/pdf;base64,${Buffer.from("%PDF").toString("base64")}`, { expect: "image" }), /عکس نیست/);
  });

  test("unsafe file names are cleaned", async () => {
    const m = await loadMedia(`data:text/plain;name=${encodeURIComponent("../../etc/passwd")};base64,eA==`);
    assert.ok(!m.filename.includes("/"));
  });
});

describe("download guard (no internal addresses)", () => {
  test("localhost, private and metadata IPs are blocked by default", async () => {
    configureMedia({});
    for (const url of [
      "http://localhost/x.png",
      "http://127.0.0.1:9/x.png",
      "http://10.1.2.3/x.png",
      "http://192.168.1.1/x.png",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/x.png",
      "http://[::ffff:127.0.0.1]/x.png",
      "http://[::ffff:a9fe:a9fe]/x.png",
      "http://[64:ff9b::a00:1]/x.png",
      "http://[fd00::1]/x.png",
      "http://0.0.0.0/x.png",
      "http://metadata.google.internal/x",
    ]) {
      await assert.rejects(loadMedia(url), /آدرس داخلی/, url);
    }
  });

  test("ALLOW_PRIVATE_MEDIA_URLS=true lifts the guard (request then fails normally)", async () => {
    configureMedia({ ALLOW_PRIVATE_MEDIA_URLS: "true" });
    await assert.rejects(loadMedia("http://127.0.0.1:9/x.png"), (e: any) => !/آدرس داخلی/.test(e.message));
    configureMedia({});
  });
});

describe("summarizeForLog", () => {
  test("shortens large data URLs anywhere in the args, leaves the rest", () => {
    const big = `data:image/png;base64,${"A".repeat(4000)}`;
    const out: any = summarizeForLog({ photo: big, caption: "hi", nested: [big] });
    assert.match(out.photo, /^data:image\/png;base64,… \(\d+ KB\)$/);
    assert.equal(out.caption, "hi");
    assert.match(out.nested[0], /KB\)$/);
  });
});
