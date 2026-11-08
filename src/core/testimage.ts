/**
 * یک عکس PNG کوچک برای «تست کامل» — بدون فایل همراه و بدون وابستگی.
 * لاجوردی با یک دایره‌ی فیروزه‌ای (همان نشان dibaMCP).
 */
import { crc32, deflateSync } from "node:zlib";

function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

export function testImagePng(w = 320, h = 180): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.28;
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    raw[row] = 0; // بدون فیلتر
    for (let x = 0; x < w; x++) {
      const t = y / h;
      // گرادیان لاجورد ← آبی تیره
      let R = Math.round(19 + 17 * t), G = Math.round(28 + 22 * t), B = Math.round(74 + 48 * t);
      const d = Math.hypot(x - cx, y - cy);
      if (d < r) [R, G, B] = [43, 179, 163]; // فیروزه
      else if (d < r + 6) [R, G, B] = [36, 50, 122]; // حلقه
      const i = row + 1 + x * 3;
      raw[i] = R;
      raw[i + 1] = G;
      raw[i + 2] = B;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function testImageDataUrl(): string {
  return `data:image/png;name=dibamcp-test.png;base64,${testImagePng().toString("base64")}`;
}
