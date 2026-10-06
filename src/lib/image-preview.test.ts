import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { animationCandidate, imageType, safeImageBlob } from "./image-preview";

const text = (value: string) => new TextEncoder().encode(value);
function png(width: number, height: number) {
  const bytes = new Uint8Array(45);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set(text("IHDR"), 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes.set(text("IEND"), 37);
  return bytes;
}
function webpChunk(kind: string, data: Uint8Array) {
  const result = new Uint8Array(8 + data.length + (data.length & 1));
  result.set(text(kind));
  new DataView(result.buffer).setUint32(4, data.length, true);
  result.set(data, 8);
  return result;
}
function webp(...chunks: Uint8Array[]) {
  const bytes = new Uint8Array(12 + chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  bytes.set(text("RIFF"));
  new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
  bytes.set(text("WEBP"), 8);
  let offset = 12;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
function u24(bytes: Uint8Array, offset: number, value: number) {
  bytes.set([value & 255, (value >> 8) & 255, (value >> 16) & 255], offset);
}
function lossless(width: number, height: number) {
  const bytes = new Uint8Array(5);
  bytes[0] = 0x2f;
  new DataView(bytes.buffer).setUint32(1, (width - 1) | ((height - 1) << 14), true);
  return webpChunk("VP8L", bytes);
}

describe("B10/B18 image checks before raster decoding", () => {
  it("retains animation safeguards for MIME-only images regardless of casing or parameters", () => {
    for (const type of ["IMAGE/GIF ; version=1", " Image/WebP; version=1", "IMAGE/AVIF"])
      expect(animationCandidate({ id: "x", name: "attachment", type, size: 1 })).toBe(true);
    expect(imageType({ id: "x", name: "attachment", type: " IMAGE/PNG; x=y ", size: 1 })).toBe(
      "image/png",
    );
    expect(animationCandidate({ id: "x", name: "still.png", type: "image/png", size: 1 })).toBe(
      false,
    );
  });

  it("permits real bounded PNG, baseline/progressive JPEG, GIF and lossless/lossy WebP files", async () => {
    const image = sharp({ create: { width: 17, height: 11, channels: 3, background: "red" } });
    const formats = [
      ["image/png", await image.clone().png().toBuffer()],
      ["image/jpeg", await image.clone().jpeg().toBuffer()],
      ["image/jpeg", await image.clone().jpeg({ progressive: true }).toBuffer()],
      ["image/gif", await image.clone().gif().toBuffer()],
      ["image/webp", await image.clone().webp().toBuffer()],
      ["image/webp", await image.clone().webp({ lossless: true }).toBuffer()],
    ] as const;
    await Promise.all(
      formats.map(async ([mime, bytes]) => {
        const blob = safeImageBlob(new Uint8Array(bytes), mime);
        expect(blob.type).toBe(mime);
        expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array(bytes));
        expect(() => safeImageBlob(new Uint8Array(bytes.subarray(0, 15)), mime)).toThrow();
      }),
    );
  });

  it("rejects compressed oversized images while allowing the documented 40 MP boundary", async () => {
    expect(safeImageBlob(png(8000, 5000), "image/png").type).toBe("image/png");
    expect(() => safeImageBlob(png(8001, 5000), "image/png")).toThrow(/40-megapixel/);
    expect(() => safeImageBlob(png(0, 5000), "image/png")).toThrow(/safely verified/);
    const image = sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } });
    const jpeg = new Uint8Array(await image.clone().jpeg().toBuffer());
    const sof = jpeg.findIndex((value, index) => value === 0xff && jpeg[index + 1] === 0xc0);
    const jpegView = new DataView(jpeg.buffer);
    jpegView.setUint16(sof + 5, 65000);
    jpegView.setUint16(sof + 7, 65000);
    expect(() => safeImageBlob(jpeg, "image/jpeg")).toThrow(/40-megapixel/);
    const gif = new Uint8Array(await image.clone().gif().toBuffer());
    const gifView = new DataView(gif.buffer);
    gifView.setUint16(6, 65000, true);
    gifView.setUint16(8, 65000, true);
    expect(() => safeImageBlob(gif, "image/gif")).toThrow(/40-megapixel/);
    expect(() => safeImageBlob(webp(lossless(10000, 10000)), "image/webp")).toThrow(/40-megapixel/);
  });

  it("checks encoded WebP frames even when an extended or animated canvas claims a small size", () => {
    const canvas = new Uint8Array(10);
    u24(canvas, 4, 9);
    u24(canvas, 7, 9);
    expect(() =>
      safeImageBlob(webp(webpChunk("VP8X", canvas), lossless(10000, 10000)), "image/webp"),
    ).toThrow(/40-megapixel/);
    const frame = new Uint8Array(16 + lossless(10, 10).length);
    u24(frame, 6, 9);
    u24(frame, 9, 9);
    frame.set(lossless(10, 10), 16);
    const valid = webp(webpChunk("VP8X", canvas), webpChunk("ANMF", frame));
    expect(safeImageBlob(valid, "image/webp").type).toBe("image/webp");
    const oversized = new Uint8Array(16 + lossless(10000, 10000).length);
    u24(oversized, 6, 9);
    u24(oversized, 9, 9);
    oversized.set(lossless(10000, 10000), 16);
    expect(() =>
      safeImageBlob(webp(webpChunk("VP8X", canvas), webpChunk("ANMF", oversized)), "image/webp"),
    ).toThrow(/40-megapixel/);
    u24(frame, 0, 1); // A nonzero left offset puts this 10px frame outside its 10px canvas.
    expect(() =>
      safeImageBlob(webp(webpChunk("VP8X", canvas), webpChunk("ANMF", frame)), "image/webp"),
    ).toThrow(/safely verified/);
  });

  it("rejects APNG and GIF frames that exceed their bounded canvas", () => {
    const apng = new Uint8Array(83);
    apng.set(png(20, 20).subarray(0, 33));
    const view = new DataView(apng.buffer);
    view.setUint32(33, 26);
    apng.set(text("fcTL"), 37);
    view.setUint32(45, 20);
    view.setUint32(49, 20);
    apng.set(png(20, 20).subarray(33), 71);
    expect(safeImageBlob(apng, "image/png").type).toBe("image/png");
    view.setUint32(45, 10000);
    view.setUint32(49, 10000);
    expect(() => safeImageBlob(apng, "image/png")).toThrow(/40-megapixel/);
    view.setUint32(45, 20);
    view.setUint32(49, 20);
    view.setUint32(53, 1);
    expect(() => safeImageBlob(apng, "image/png")).toThrow(/safely verified/);
    const gif = new Uint8Array(26);
    gif.set(text("GIF89a"));
    const gifView = new DataView(gif.buffer);
    gifView.setUint16(6, 20, true);
    gifView.setUint16(8, 20, true);
    gif[13] = 0x2c;
    gifView.setUint16(18, 20, true);
    gifView.setUint16(20, 20, true);
    gif[23] = 2;
    gif[25] = 0x3b;
    expect(safeImageBlob(gif, "image/gif").type).toBe("image/gif");
    gifView.setUint16(18, 65000, true);
    gifView.setUint16(20, 65000, true);
    expect(() => safeImageBlob(gif, "image/gif")).toThrow(/40-megapixel/);
  });

  it("fails closed for unknown encodings, MIME mismatches and malformed chunk lengths", () => {
    for (const mime of ["image/svg+xml", "image/avif", "image/bmp", "image/webp"])
      expect(() => safeImageBlob(png(20, 20), mime)).toThrow(/safely verified/);
    const malformed = png(20, 20);
    new DataView(malformed.buffer).setUint32(8, 0xffffffff);
    expect(() => safeImageBlob(malformed, "image/png")).toThrow(/safely verified/);
    expect(() => safeImageBlob(text('<svg width="100000" height="100000"/>'), "image/png")).toThrow(
      /safely verified/,
    );
  });
});
