import Papa from "papaparse";
import { decodeByteText, encodedUnitStop } from "./byte-text";

export const TABLE_BYTE_LIMIT = 2 * 1024 * 1024;
export const TABLE_ROW_LIMIT = 1000;
export const TABLE_COLUMN_LIMIT = 100;
export const TABLE_CELL_LIMIT = 10_000;
export type TablePreviewData = {
  records: string[][];
  partialBytes: boolean;
  partialRows: boolean;
  partialColumns: boolean;
  partialCells: boolean;
  encoding: string;
};

// Tracks delimiters only outside properly opened quoted fields. A quote at the
// end of a network chunk stays pending until an escaped quote or separator is
// received. Embedded quoted newlines never advance the record budget.
function recordState(delimiter: string) {
  let quoted = false;
  let pendingQuote = false;
  let fieldStart = true;
  let wasCR = false;
  return {
    get openQuote() {
      return quoted && !pendingQuote;
    },
    unit(value: number): "field" | "record" | "content" | "crlf" {
      if (quoted) {
        if (pendingQuote) {
          pendingQuote = false;
          if (value === 34) return "content";
          quoted = false;
        } else {
          if (value === 34) pendingQuote = true;
          return "content";
        }
      }
      if (value === 10 && wasCR) {
        wasCR = false;
        return "crlf";
      }
      wasCR = false;
      if (value === 13 || value === 10) {
        fieldStart = true;
        wasCR = value === 13;
        return "record";
      }
      if (value === delimiter.charCodeAt(0)) {
        fieldStart = true;
        return "field";
      }
      if (value === 34 && fieldStart) quoted = true;
      fieldStart = false;
      return "content";
    },
  };
}

export function completeTableRowStop(delimiter: string, limit = TABLE_ROW_LIMIT + 1) {
  const state = recordState(delimiter);
  let rows = 0;
  return encodedUnitStop((value) => {
    if (state.unit(value) === "record") rows++;
    return rows >= limit;
  });
}

export function parseTablePreview(
  bytes: Uint8Array,
  originalSize: number,
  delimiter: string,
): TablePreviewData {
  const partialBytes = bytes.length < originalSize;
  const decoded = decodeByteText(bytes, partialBytes);
  const state = recordState(delimiter);
  const records: string[] = [];
  let record = "";
  let columns = 1;
  let partialColumns = false;
  let partialRows = false;
  let hasRecordContent = false;
  for (let index = 0; index < decoded.text.length; index++) {
    const character = decoded.text[index];
    const event = state.unit(character.charCodeAt(0));
    if (event === "crlf") continue;
    if (event === "record") {
      records.push(record);
      record = "";
      columns = 1;
      hasRecordContent = false;
      if (records.length >= TABLE_ROW_LIMIT + 1) {
        partialRows = index < decoded.text.length - 1 || partialBytes;
        break;
      }
    } else {
      hasRecordContent = true;
      if (event === "field") {
        columns++;
        if (columns > TABLE_COLUMN_LIMIT) partialColumns = true;
      }
      // No parser ever receives discarded columns, even a row containing
      // hundreds of thousands of delimiters within the byte budget.
      if (columns <= TABLE_COLUMN_LIMIT) record += character;
    }
  }
  if (records.length < TABLE_ROW_LIMIT + 1 && hasRecordContent && !partialBytes) {
    if (state.openQuote)
      throw new Error(
        "The table has an unclosed quoted field. Download the original to inspect it.",
      );
    records.push(record);
  }
  if (!records.length)
    throw new Error(
      partialBytes
        ? "No complete table row fits within the 2 MiB preview limit. Download the original."
        : "This table has no rows to display.",
    );
  const parsed: string[][] = [];
  let parseError = "";
  Papa.parse<string[]>(records.join("\n"), {
    delimiter,
    header: false,
    dynamicTyping: false,
    skipEmptyLines: false,
    step(result, parser) {
      if (result.errors.length) {
        parseError =
          "The table contains malformed quoted fields. Download the original to inspect it.";
        parser.abort();
      } else {
        parsed.push(result.data);
        if (parsed.length >= TABLE_ROW_LIMIT + 1) parser.abort();
      }
    },
  });
  if (parseError) throw new Error(parseError);
  const partialCells = parsed.some((row) => row.some((cell) => cell.length > TABLE_CELL_LIMIT));
  return {
    records: parsed.map((row) =>
      row.map((cell) =>
        cell.length > TABLE_CELL_LIMIT ? `${cell.slice(0, TABLE_CELL_LIMIT - 1)}…` : cell,
      ),
    ),
    partialBytes,
    partialRows,
    partialColumns,
    partialCells,
    encoding: decoded.encoding,
  };
}

export function tableView(data: TablePreviewData, firstRowIsData: boolean) {
  const columns = Math.max(...data.records.map((row) => row.length));
  const header = data.records[0];
  const headings = Array.from({ length: columns }, (_, index) => {
    const name = firstRowIsData ? "" : (header[index] ?? "");
    return name ? `${name} (column ${index + 1})` : `Column ${index + 1}`;
  });
  const rows = (firstRowIsData ? data.records : data.records.slice(1)).slice(0, TABLE_ROW_LIMIT);
  return {
    headings,
    rows,
    partialRows: data.partialRows || (firstRowIsData && data.records.length > TABLE_ROW_LIMIT),
  };
}
