import { formatFileSize } from "@/lib/format-file-size";

export function FileSize({ bytes, className = "" }: { bytes: number; className?: string }) {
  return (
    <span
      className={`whitespace-nowrap tabular-nums ${className}`.trim()}
      title={`${bytes.toLocaleString("en-GB")} ${bytes === 1 ? "byte" : "bytes"}`}
    >
      {formatFileSize(bytes)}
    </span>
  );
}
