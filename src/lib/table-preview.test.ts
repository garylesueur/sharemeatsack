import { describe, expect, it } from "vitest";
import {
  completeTableRowStop,
  parseTablePreview,
  tableView,
  TABLE_CELL_LIMIT,
} from "./table-preview";

const utf8 = (text: string) => new TextEncoder().encode(text);
const parse = (text: string, delimiter = ",") =>
  parseTablePreview(utf8(text), utf8(text).length, delimiter);
function utf16(text: string, bigEndian = false) {
  const bytes = new Uint8Array(2 + text.length * 2);
  bytes.set(bigEndian ? [254, 255] : [255, 254]);
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    bytes.set(bigEndian ? [code >> 8, code & 255] : [code & 255, code >> 8], 2 + index * 2);
  }
  return bytes;
}

describe("bounded table parsing", () => {
  it("preserves quoted delimiters, escaped quotes, multiline cells and CRLF", () => {
    const result = parse('Name,Notes\r\n"A, B","line 1\r\nline 2 with ""quotes"""\r\n');
    expect(result.records).toEqual([
      ["Name", "Notes"],
      ["A, B", 'line 1\r\nline 2 with "quotes"'],
    ]);
    expect(tableView(result, false).rows).toHaveLength(1);
  });
  it("supports quoted TSV and UTF-8/UTF-16 BOM without text line caps", () => {
    const text = 'Name\tNotes\nAda\t"hello\tthere\nnext"';
    expect(parse(text, "\t").records[1]).toEqual(["Ada", "hello\tthere\nnext"]);
    for (const bigEndian of [false, true]) {
      const bytes = utf16("Name,Notes\nAda,café", bigEndian);
      expect(parseTablePreview(bytes, bytes.length, ",").records[1]).toEqual(["Ada", "café"]);
    }
    expect(parse("\ufeffName,Notes\nAda,café").records[0]).toEqual(["Name", "Notes"]);
  });
  it("distinguishes duplicate/empty headers by position and retains the first data row", () => {
    const result = parse("Name,,Name\nA,B,C");
    expect(tableView(result, false).headings).toEqual([
      "Name (column 1)",
      "Column 2",
      "Name (column 3)",
    ]);
    expect(tableView(result, true)).toMatchObject({
      headings: ["Column 1", "Column 2", "Column 3"],
      rows: [
        ["Name", "", "Name"],
        ["A", "B", "C"],
      ],
    });
  });
  it("cuts partial quoted records without confusing truncation with corrupt content", () => {
    const text = 'Name,Notes\nAda,"complete\nrecord"\nBob,"cut\nrecord';
    const result = parseTablePreview(utf8(text), utf8(text).length + 20, ",");
    expect(result.records).toEqual([
      ["Name", "Notes"],
      ["Ada", "complete\nrecord"],
    ]);
    expect(result.partialBytes).toBe(true);
    expect(() => parse(text)).toThrow("unclosed");
    expect(() => parse('A,B\n"bad"oops,x')).toThrow("malformed");
    expect(() => parseTablePreview(utf8('"cut'), 100, ",")).toThrow("No complete table row");
  });
  it("enforces rows, columns and displayed cell length before rendering", () => {
    const many = parse(`H\n${Array.from({ length: 1002 }, (_, index) => index).join("\n")}`);
    expect(many.records).toHaveLength(1001);
    expect(many.partialRows).toBe(true);
    expect(tableView(many, false).rows).toHaveLength(1000);
    expect(tableView(many, true).rows).toHaveLength(1000);
    const wide = parse(Array.from({ length: 10000 }, (_, index) => `c${index}`).join(","));
    expect(wide.records[0]).toHaveLength(100);
    expect(wide.records[0].at(-1)).toBe("c99");
    expect(wide.partialColumns).toBe(true);
    const largeCell = parse(`H\n${"x".repeat(TABLE_CELL_LIMIT + 100)}`);
    expect(largeCell.records[1][0]).toHaveLength(TABLE_CELL_LIMIT);
    expect(largeCell.records[1][0].endsWith("…")).toBe(true);
    expect(largeCell.partialCells).toBe(true);
  });
  it("keeps formula-looking and HTML cells literal and rejects invalid byte encoding", () => {
    expect(parse("Formula,HTML\n=SUM(A1:A2),<script>alert(1)</script>").records[1]).toEqual([
      "=SUM(A1:A2)",
      "<script>alert(1)</script>",
    ]);
    expect(() => parseTablePreview(new Uint8Array([255, 10]), 2, ",")).toThrow("not valid");
    expect(() => parse("H\nx\u0000y")).toThrow("binary");
  });
});

describe("stream record budget", () => {
  it("counts complete quoted records across chunks, including escaped quotes and CRLF", () => {
    const stop = completeTableRowStop(",", 2);
    expect(stop(utf8('A,B\r\n"one'))).toBeUndefined();
    expect(stop(utf8('\nwith "'))).toBeUndefined();
    const last = '"quotes""",two\r\nnext';
    expect(stop(utf8(last))).toBe(last.indexOf("\r") + 1);
  });
  it("keeps UTF-16 unit boundaries and quoted line breaks across chunks", () => {
    const bytes = utf16('A,B\n"one\ntwo",ok\nnext', true);
    const stop = completeTableRowStop(",", 2);
    expect(stop(bytes.subarray(0, 1))).toBeUndefined();
    expect(stop(bytes.subarray(1, 19))).toBeUndefined();
    const ending = stop(bytes.subarray(19));
    expect(ending).toBeDefined();
    const cut = bytes.subarray(0, 19 + ending!);
    expect(parseTablePreview(cut, bytes.length, ",").records).toEqual([
      ["A", "B"],
      ["one\ntwo", "ok"],
    ]);
  });
});
