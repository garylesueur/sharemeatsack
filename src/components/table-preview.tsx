"use client";

// The scrollable table region receives keyboard focus. Keys identify immutable
// row and column positions within the selected read-only preview.
/* oxlint-disable jsx-a11y/no-noninteractive-tabindex, react/no-array-index-key */

import { useEffect, useState } from "react";
import { type ReadUrl } from "@/lib/file-access";
import { fileExtension, type ViewFile } from "@/lib/file-view";
import { readPreviewBytes, shouldRenew } from "@/lib/preview-bytes";
import {
  completeTableRowStop,
  parseTablePreview,
  tableView,
  TABLE_BYTE_LIMIT,
  type TablePreviewData,
} from "@/lib/table-preview";

export function TablePreview({
  file,
  source,
  fail,
  renew,
}: {
  file: ViewFile;
  source: ReadUrl;
  fail: (message: string) => void;
  renew: () => Promise<unknown>;
}) {
  const [content, setContent] = useState<{ source: string; data: TablePreviewData } | null>(null);
  const [firstRowIsData, setFirstRowIsData] = useState(false);
  const delimiter =
    fileExtension(file) === "tsv" ||
    file.type.toLowerCase().split(";")[0].trim() === "text/tab-separated-values"
      ? "\t"
      : ",";
  useEffect(() => {
    const controller = new AbortController();
    let fetched = false;
    readPreviewBytes(
      source.url,
      TABLE_BYTE_LIMIT,
      controller.signal,
      completeTableRowStop(delimiter),
    )
      .then((bytes) => {
        controller.signal.throwIfAborted();
        fetched = true;
        setContent({ source: source.url, data: parseTablePreview(bytes, file.size, delimiter) });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (!fetched && shouldRenew(error, source.expiresAt)) void renew();
        else fail(error instanceof Error ? error.message : "This table could not be loaded.");
      });
    return () => controller.abort();
  }, [source, delimiter, file.size, fail, renew]);
  const data = content?.source === source.url ? content.data : null;
  if (!data)
    return <output className="mt-6 block p-6 text-sm text-muted-foreground">Loading table…</output>;
  const view = tableView(data, firstRowIsData);
  return (
    <section className="mt-6 min-w-0" aria-label="Table reader">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 text-sm focus-within:outline-2 focus-within:outline-ring">
          <input
            type="checkbox"
            checked={firstRowIsData}
            onChange={(event) => setFirstRowIsData(event.target.checked)}
            className="size-5 accent-primary"
          />
          First row is data
        </label>
        <output className="text-sm text-muted-foreground">
          {view.rows.length.toLocaleString("en-GB")} data rows · {view.headings.length} columns ·{" "}
          {data.encoding}
        </output>
      </div>
      {data.partialBytes || view.partialRows || data.partialColumns || data.partialCells ? (
        <p className="mb-4 rounded-lg border border-border bg-card p-3 text-sm">
          Partial preview.
          {data.partialBytes
            ? " Only complete records within the first 2 MiB and row budget are shown; an incomplete final record is omitted."
            : ""}
          {view.partialRows ? " Limited to 1,000 data rows." : ""}
          {data.partialColumns ? " Limited to the first 100 columns." : ""}
          {data.partialCells
            ? " Cells longer than 10,000 characters are shortened with an ellipsis."
            : ""}{" "}
          Download the original for the complete table.
        </p>
      ) : null}
      <section
        className="max-h-[70vh] max-w-full overflow-auto rounded-xl border border-border bg-card focus-visible:outline-2 focus-visible:outline-ring"
        aria-label="Scrollable table"
        tabIndex={0}
      >
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            {file.name} —{" "}
            {firstRowIsData
              ? "numbered columns, first row retained as data"
              : "first complete row used as column labels"}
          </caption>
          <thead className="sticky top-0 z-10 bg-card">
            <tr>
              {view.headings.map((heading, index) => (
                <th
                  key={index}
                  scope="col"
                  className="max-w-80 min-w-32 whitespace-pre-wrap break-words border-b border-border px-4 py-3 text-left align-top font-semibold"
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="even:bg-muted/20">
                {view.headings.map((_, columnIndex) => (
                  <td
                    key={columnIndex}
                    className="max-w-80 min-w-32 whitespace-pre-wrap break-words border-b border-border px-4 py-3 align-top"
                  >
                    {row[columnIndex] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!view.rows.length ? (
          <p className="p-5 text-sm text-muted-foreground">
            The first row supplies the column labels. Select First row is data to view it as a data
            row.
          </p>
        ) : null}
      </section>
    </section>
  );
}
