import { describe, expect, it } from "vitest";
import {
  decodeTextPreview,
  completeLineStop,
  markdownTarget,
  TEXT_BYTE_LIMIT,
  type TextPreview,
} from "./text-preview";
import { type ViewFile } from "./file-view";

const encode = (text: string) => new TextEncoder().encode(text);
const read = (text: string): TextPreview => decodeTextPreview(encode(text), encode(text).length);
const file = (
  name: string,
  downloadUrl: string | undefined = "https://store.example/file",
): ViewFile => ({ id: name, name, type: "text/plain", size: 1, downloadUrl });

describe("bounded text decoding", () => {
  it("stops incoming bytes at complete UTF-8/UTF-16 lines across chunk boundaries", () => {
    const stop = completeLineStop(2);
    expect(stop(encode("a\r"))).toBeUndefined();
    expect(stop(encode("\nb\nmore"))).toBe(3);
    const utf16 = completeLineStop(1);
    expect(utf16(new Uint8Array([255]))).toBeUndefined();
    expect(utf16(new Uint8Array([254, 65]))).toBeUndefined();
    expect(utf16(new Uint8Array([0, 10, 0, 66, 0]))).toBe(3);
  });
  it("supports UTF-8, UTF-8 BOM and both BOM-marked UTF-16 orders", () => {
    expect(read("one\r\ntwo\rthree").text).toBe("one\ntwo\nthree");
    expect(decodeTextPreview(new Uint8Array([239, 187, 191, 65]), 4).text).toBe("A");
    expect(decodeTextPreview(new Uint8Array([255, 254, 65, 0, 10, 0]), 6)).toMatchObject({
      text: "A\n",
      encoding: "UTF-16LE",
    });
    expect(decodeTextPreview(new Uint8Array([254, 255, 0, 65]), 4)).toMatchObject({
      text: "A",
      encoding: "UTF-16BE",
    });
  });
  it("drops incomplete units and final lines only at a known byte cut", () => {
    expect(decodeTextPreview(new Uint8Array([65, 10, 66, 0xe2, 0x82]), 7)).toMatchObject({
      text: "A\n",
      partial: true,
    });
    expect(decodeTextPreview(new Uint8Array([255, 254, 65, 0, 10, 0, 66]), 10)).toMatchObject({
      text: "A\n",
      partial: true,
    });
    expect(() => decodeTextPreview(new Uint8Array([65, 0xe2, 0x82]), 3)).toThrow("not valid");
    expect(read("final line")).toMatchObject({ text: "final line", partial: false });
  });
  it("rejects invalid sequences before a cut and binary control characters", () => {
    expect(() => decodeTextPreview(new Uint8Array([0xff, 10]), 100)).toThrow("not valid");
    expect(() => read("a\u0000b")).toThrow("binary content");
  });
  it("caps complete lines and labels a byte cut, including a line longer than the entire cap", () => {
    const result = read("line\n".repeat(10_002));
    expect(result).toMatchObject({ partial: true, lines: 10_000 });
    expect(result.text).toBe("line\n".repeat(10_000));
    expect(
      decodeTextPreview(encode("x".repeat(TEXT_BYTE_LIMIT)), TEXT_BYTE_LIMIT + 1),
    ).toMatchObject({ text: "", lines: 0, partial: true });
  });
  it("keeps active HTML literal source", () => {
    const html = '<script>alert("unsafe")</script>';
    expect(read(html).text).toBe(html);
  });
});

describe("Markdown capabilities and links", () => {
  it("accepts only explicit navigation protocols and local anchors", () => {
    for (const value of [
      "javascript:alert(1)",
      "data:image/svg+xml,x",
      "file:///tmp/a",
      "//remote.example/a",
      "https://user:pass@example.com",
      "java\nscript:x",
    ])
      expect(markdownTarget(value, [])).toEqual({ kind: "unavailable" });
    expect(markdownTarget("https://example.com/a", [])).toEqual({
      kind: "external",
      url: "https://example.com/a",
    });
    expect(markdownTarget("mailto:hello@example.com", []).kind).toBe("external");
    expect(markdownTarget("#heading", [])).toEqual({ kind: "anchor", url: "#heading" });
  });
  it("resolves exact, uniquely named permitted attachments without traversal or query tokens", () => {
    const files = [
      file("A file.md"),
      { ...file("blocked.md"), downloadUrl: undefined },
      file("dup.md"),
      file("dup.md"),
    ];
    expect(markdownTarget("./A%20file.md", files)).toEqual({ kind: "attachment", file: files[0] });
    for (const value of [
      "a file.md",
      "blocked.md",
      "dup.md",
      "../A%20file.md",
      "/A%20file.md",
      "folder/A%20file.md",
      "%2e%2e%2fA%20file.md",
      "A%20file.md?t=secret",
      "A%20file.md#heading",
      "bad%zz",
    ])
      expect(markdownTarget(value, files)).toEqual({ kind: "unavailable" });
  });
});
