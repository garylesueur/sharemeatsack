export function decodeByteText(bytes: Uint8Array, partial: boolean) {
  let encoding = "utf-8";
  let offset = 0;
  if (bytes[0] === 255 && bytes[1] === 254) {
    encoding = "utf-16le";
    offset = 2;
  } else if (bytes[0] === 254 && bytes[1] === 255) {
    encoding = "utf-16be";
    offset = 2;
  } else if (bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191) offset = 3;
  let text: string;
  try {
    text = new TextDecoder(encoding, { fatal: true }).decode(bytes.subarray(offset), {
      stream: partial,
    });
  } catch {
    throw new Error("This file is not valid UTF-8 or BOM-marked UTF-16. Download the original.");
  }
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if ((code < 32 && ![9, 10, 12, 13].includes(code)) || code === 127)
      throw new Error("This file contains binary content and cannot be shown as text.");
  }
  return { text, encoding: encoding.toUpperCase() };
}

// Delimiter/quote/line controls are ASCII units in UTF-8 and UTF-16. Keep BOM
// detection and split UTF-16 units across network chunks without buffering text.
export function encodedUnitStop(stop: (unit: number) => boolean) {
  let first: number | undefined;
  let mode: "utf8" | "le" | "be" | undefined;
  let half: number | undefined;
  return (chunk: Uint8Array): number | undefined => {
    for (let index = 0; index < chunk.length; index++) {
      const value = chunk[index];
      if (!mode) {
        if (first === undefined) {
          first = value;
          continue;
        }
        if (first === 255 && value === 254) mode = "le";
        else if (first === 254 && value === 255) mode = "be";
        else {
          mode = "utf8";
          if (stop(first)) return index;
          if (stop(value)) return index + 1;
        }
      } else if (mode === "utf8") {
        if (stop(value)) return index + 1;
      } else if (half === undefined) half = value;
      else {
        const decoded = mode === "le" ? half + value * 256 : half * 256 + value;
        half = undefined;
        if (stop(decoded)) return index + 1;
      }
    }
    return undefined;
  };
}
