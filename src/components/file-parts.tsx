"use client";

import { useState } from "react";
import { scanLabel, type FileFamily, type ViewFile } from "@/lib/file-view";
import { useFileAccess } from "./file-access";
import { FileSize } from "./file-size";

export const fileActionClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40";

export function FileIcon({
  className = "size-8",
  family = "other",
}: {
  className?: string;
  family?: FileFamily;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {family === "image" ? (
        <>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8" cy="8" r="1.5" />
          <path d="m3 17 5-5 4 4 4-6 5 7" />
        </>
      ) : family === "video" ? (
        <>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="m10 8 6 4-6 4Z" />
        </>
      ) : family === "audio" ? (
        <>
          <path d="M9 18V5l11-2v13M9 8l11-2" />
          <ellipse cx="6" cy="18" rx="3" ry="2" />
          <ellipse cx="17" cy="16" rx="3" ry="2" />
        </>
      ) : family === "table" ? (
        <>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
        </>
      ) : (
        <>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
          <path d="M14 2v6h6M8 13h8M8 17h5" />
        </>
      )}
    </svg>
  );
}

export function FileDetails({ file }: { file: ViewFile }) {
  return (
    <div className="min-w-0 flex-1">
      <h3 className="break-all text-base font-medium leading-relaxed">{file.name}</h3>
      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <FileSize bytes={file.size} />
        <span>{scanLabel(file)}</span>
      </p>
    </div>
  );
}

export function FileDownload({ file }: { file: ViewFile }) {
  const access = useFileAccess();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  if (access.denied.has(file.id))
    return (
      <output className="text-sm text-muted-foreground">
        This file is no longer available through this link.
      </output>
    );
  return file.downloadUrl ? (
    <div className="flex shrink-0 flex-col gap-2">
      <a
        className={`${fileActionClass} shrink-0`}
        href={file.downloadUrl}
        referrerPolicy="no-referrer"
        aria-label={`Download original: ${file.name}`}
        aria-busy={loading}
        onClick={async (event) => {
          event.preventDefault();
          if (loading) return;
          setLoading(true);
          setError("");
          try {
            const result = await access.read(file.id, "download", true);
            // An attachment response keeps the current viewer open.
            const link = document.createElement("a");
            link.href = result.url;
            link.referrerPolicy = "no-referrer";
            link.download = file.name;
            link.click();
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : "Could not download. Try again.");
          } finally {
            setLoading(false);
          }
        }}
      >
        {loading ? "Preparing download…" : "Download original"}
      </a>
      {error ? <output className="max-w-xs text-sm text-muted-foreground">{error}</output> : null}
    </div>
  ) : null;
}
