import { fileExtension, type ViewFile } from "./file-view";

const pixelLimit = 40_000_000;
const unsupported = "This image's dimensions cannot be safely verified. Download the original.";
const normalizedMime = (value: string) => value.toLowerCase().split(";", 1)[0].trim();

export function animationCandidate(file: ViewFile) {
  return (
    ["gif", "webp", "avif"].includes(fileExtension(file)) ||
    /^image\/(gif|webp|avif)$/.test(normalizedMime(file.type))
  );
}

export function imageType(file: ViewFile) {
  const mime = normalizedMime(file.type);
  return mime.startsWith("image/")
    ? mime
    : ((
        {
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          gif: "image/gif",
          webp: "image/webp",
        } as Record<string, string>
      )[fileExtension(file)] ?? "application/octet-stream");
}

// Inspect encoded raster headers before creating a Blob URL or invoking an image
// decoder. Unknown formats fail closed: AVIF container dimensions need not bound
// its coded AV1 frame, and SVG can embed independently sized raster resources.
export function safeImageBlob(bytes: Uint8Array<ArrayBuffer>, mime: string) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset: number, length: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));
  const dimensions = (width: number, height: number) => {
    if (!width || !height || !Number.isFinite(width * height)) throw new Error(unsupported);
    if (width * height > pixelLimit)
      throw new Error("This image exceeds the 40-megapixel preview limit. Download the original.");
    return { width, height };
  };
  const requireBytes = (offset: number, size: number, end = bytes.length) => {
    if (offset < 0 || size < 0 || offset + size > end) throw new Error(unsupported);
  };
  const u24 = (offset: number) =>
    bytes[offset] + bytes[offset + 1] * 256 + bytes[offset + 2] * 65536;

  if (mime === "image/png") {
    requireBytes(0, 33);
    if (text(0, 8) !== "\x89PNG\r\n\x1a\n" || text(12, 4) !== "IHDR" || view.getUint32(8) !== 13)
      throw new Error(unsupported);
    const canvas = dimensions(view.getUint32(16), view.getUint32(20));
    let offset = 8;
    while (offset < bytes.length) {
      requireBytes(offset, 12);
      const size = view.getUint32(offset);
      requireBytes(offset + 8, size + 4);
      const chunk = text(offset + 4, 4);
      if (chunk === "IHDR" && offset !== 8) throw new Error(unsupported);
      if (chunk === "fcTL") {
        if (size !== 26) throw new Error(unsupported);
        const frame = dimensions(view.getUint32(offset + 12), view.getUint32(offset + 16));
        if (
          frame.width + view.getUint32(offset + 20) > canvas.width ||
          frame.height + view.getUint32(offset + 24) > canvas.height
        )
          throw new Error(unsupported);
      }
      offset += size + 12;
      if (chunk === "IEND") return new Blob([bytes], { type: mime });
    }
  } else if (mime === "image/jpeg") {
    requireBytes(0, 2);
    if (view.getUint16(0) !== 0xffd8) throw new Error(unsupported);
    let offset = 2;
    let found = false;
    while (offset < bytes.length) {
      if (bytes[offset++] !== 0xff) throw new Error(unsupported);
      while (bytes[offset] === 0xff) offset++;
      requireBytes(offset, 1);
      const marker = bytes[offset++];
      requireBytes(offset, 2);
      const size = view.getUint16(offset);
      if (size < 2) throw new Error(unsupported);
      requireBytes(offset, size);
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (found || size < 8) throw new Error(unsupported);
        dimensions(view.getUint16(offset + 5), view.getUint16(offset + 3));
        found = true;
      } else if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        throw new Error(unsupported);
      }
      if (marker === 0xda && found) return new Blob([bytes], { type: mime });
      offset += size;
    }
  } else if (mime === "image/gif") {
    requireBytes(0, 13);
    if (!["GIF87a", "GIF89a"].includes(text(0, 6))) throw new Error(unsupported);
    const canvas = dimensions(view.getUint16(6, true), view.getUint16(8, true));
    let offset = 13 + (bytes[10] & 0x80 ? 3 * 2 ** ((bytes[10] & 7) + 1) : 0);
    let found = false;
    const skipBlocks = () => {
      while (true) {
        requireBytes(offset, 1);
        const size = bytes[offset++];
        requireBytes(offset, size);
        offset += size;
        if (!size) return;
      }
    };
    while (offset < bytes.length) {
      const block = bytes[offset++];
      if (block === 0x3b && found) return new Blob([bytes], { type: mime });
      if (block === 0x21) {
        requireBytes(offset++, 1);
        skipBlocks();
      } else if (block === 0x2c) {
        requireBytes(offset, 9);
        const frame = dimensions(
          view.getUint16(offset + 4, true),
          view.getUint16(offset + 6, true),
        );
        if (
          frame.width + view.getUint16(offset, true) > canvas.width ||
          frame.height + view.getUint16(offset + 2, true) > canvas.height
        )
          throw new Error(unsupported);
        offset += 9 + (bytes[offset + 8] & 0x80 ? 3 * 2 ** ((bytes[offset + 8] & 7) + 1) : 0);
        requireBytes(offset++, 1); // LZW minimum code size precedes data sub-blocks.
        skipBlocks();
        found = true;
      } else throw new Error(unsupported);
    }
  } else if (mime === "image/webp") {
    requireBytes(0, 12);
    if (
      text(0, 4) !== "RIFF" ||
      text(8, 4) !== "WEBP" ||
      view.getUint32(4, true) + 8 !== bytes.length
    )
      throw new Error(unsupported);
    const chunks = (start: number, end: number, parent?: { width: number; height: number }) => {
      let found = false;
      let canvas = parent;
      for (let offset = start; offset < end;) {
        requireBytes(offset, 8, end);
        const chunk = text(offset, 4);
        const size = view.getUint32(offset + 4, true);
        const data = offset + 8;
        requireBytes(data, size, end);
        let frame: { width: number; height: number } | undefined;
        if (chunk === "VP8X") {
          if (parent || size !== 10) throw new Error(unsupported);
          canvas = dimensions(u24(data + 4) + 1, u24(data + 7) + 1);
        } else if (chunk === "VP8 ") {
          if (size < 10 || bytes[data] & 1 || text(data + 3, 3) !== "\x9d\x01\x2a")
            throw new Error(unsupported);
          frame = dimensions(
            view.getUint16(data + 6, true) & 0x3fff,
            view.getUint16(data + 8, true) & 0x3fff,
          );
        } else if (chunk === "VP8L") {
          if (size < 5 || bytes[data] !== 0x2f) throw new Error(unsupported);
          const bits = view.getUint32(data + 1, true);
          frame = dimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
        } else if (chunk === "ANMF") {
          if (parent || !canvas || size < 16) throw new Error(unsupported);
          frame = dimensions(u24(data + 6) + 1, u24(data + 9) + 1);
          if (
            u24(data) * 2 + frame.width > canvas.width ||
            u24(data + 3) * 2 + frame.height > canvas.height ||
            !chunks(data + 16, data + size, frame)
          )
            throw new Error(unsupported);
        }
        if (frame) {
          if (canvas && (frame.width > canvas.width || frame.height > canvas.height))
            throw new Error(unsupported);
          found = true;
        }
        offset = data + size + (size & 1);
        if (offset > end) throw new Error(unsupported);
      }
      return found;
    };
    if (chunks(12, bytes.length)) return new Blob([bytes], { type: mime });
  }
  throw new Error(unsupported);
}
