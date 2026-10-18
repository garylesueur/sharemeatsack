import { fileFamily, type ViewFile } from "./file-view";
import { decodeByteText, encodedUnitStop } from "./byte-text";

export const TEXT_BYTE_LIMIT = 1024 * 1024;
export const TEXT_LINE_LIMIT = 10_000;
export type TextPreview = { text: string; partial: boolean; encoding: string; lines: number };

// Inspect complete line separators while bytes arrive, including BOM-marked
// UTF-16. The reader cancels before retaining subsequent chunks/source lines.
export function completeLineStop(limit = TEXT_LINE_LIMIT) {
  let lines = 0;
  let wasCR = false;
  return encodedUnitStop((value) => {
    if (value === 13 || (value === 10 && !wasCR)) lines++;
    wasCR = value === 13;
    return lines >= limit;
  });
}

export function decodeTextPreview(bytes: Uint8Array, originalSize: number): TextPreview {
  const partialBytes = originalSize > bytes.length;
  const decoded = decodeByteText(bytes, partialBytes);
  let text = decoded.text;
  text = text.replace(/\r\n?/g, "\n");
  if (partialBytes) text = text.slice(0, text.lastIndexOf("\n") + 1);
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const partialLines = lines.length > TEXT_LINE_LIMIT;
  if (partialLines) text = `${lines.slice(0, TEXT_LINE_LIMIT).join("\n")}\n`;
  return {
    text,
    partial: partialBytes || partialLines,
    encoding: decoded.encoding,
    lines: Math.min(lines.length, TEXT_LINE_LIMIT),
  };
}

export type MarkdownTarget =
  | { kind: "external" | "anchor"; url: string }
  | { kind: "attachment"; file: ViewFile }
  | { kind: "unavailable" };

function hasUnsafeControl(value: string, allowTextWhitespace = true) {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if ((code < 32 && !(allowTextWhitespace && [9, 10, 12, 13].includes(code))) || code === 127)
      return true;
  }
  return false;
}

export function markdownTarget(value: string | undefined, files: ViewFile[]): MarkdownTarget {
  if (!value || hasUnsafeControl(value, false)) return { kind: "unavailable" };
  const url = value.trim();
  if (url.startsWith("#")) return { kind: "anchor", url };
  if (/^(https?:|mailto:)/i.test(url)) {
    try {
      const parsed = new URL(url);
      if (parsed.username || parsed.password) return { kind: "unavailable" };
      return { kind: "external", url: parsed.href };
    } catch {
      return { kind: "unavailable" };
    }
  }
  let name: string;
  try {
    name = decodeURIComponent(url.replace(/^\.\//, ""));
  } catch {
    return { kind: "unavailable" };
  }
  if (/[/\\?#:]/.test(name) || [".", ".."].includes(name)) return { kind: "unavailable" };
  const matching = files.filter((file) => file.name === name);
  if (matching.length !== 1 || !matching[0].downloadUrl) return { kind: "unavailable" };
  return { kind: "attachment", file: matching[0] };
}

export function sourceLanguage(file: ViewFile) {
  const extension = file.name.toLowerCase().split(".").at(-1) ?? "";
  return (
    (
      {
        js: "javascript",
        jsx: "jsx",
        ts: "typescript",
        tsx: "tsx",
        json: "json",
        css: "css",
        html: "markup",
        htm: "markup",
        xhtml: "markup",
        xml: "markup",
        md: "markdown",
        markdown: "markdown",
        py: "python",
        rb: "ruby",
        sh: "bash",
        yaml: "yaml",
        yml: "yaml",
        sql: "sql",
        rs: "rust",
        go: "go",
        java: "java",
        c: "c",
        h: "c",
        cpp: "cpp",
      } as Record<string, string>
    )[extension] ?? (fileFamily(file) === "markdown" ? "markdown" : "plain")
  );
}
