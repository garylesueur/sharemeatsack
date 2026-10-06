"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { type ReadUrl } from "@/lib/file-access";
import { classifyFile, fileFamily, type ViewFile } from "@/lib/file-view";
import { useFileAccess } from "./file-access";
import { MediaPreview } from "./media-preview";
import { ImagePreview } from "./image-preview";
import { FileIcon, fileActionClass } from "./file-parts";

const TextPreview = dynamic(() => import("./text-preview").then((module) => module.TextPreview), {
  loading: () => (
    <output className="mt-6 block p-6 text-sm text-muted-foreground">Preparing reader…</output>
  ),
});

const PDFPreview = dynamic(() => import("./pdf-preview").then((module) => module.PDFPreview), {
  ssr: false,
  loading: () => (
    <output className="mt-6 block p-6 text-sm text-muted-foreground">Preparing PDF reader…</output>
  ),
});

const TablePreview = dynamic(
  () => import("./table-preview").then((module) => module.TablePreview),
  {
    loading: () => (
      <output className="mt-6 block p-6 text-sm text-muted-foreground">
        Preparing table reader…
      </output>
    ),
  },
);

export function usePreviewUrl(file: ViewFile, enabled: boolean) {
  const { read, denied } = useFileAccess();
  const [source, setSource] = useState<ReadUrl | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const renewed = useRef(false);
  const active = useRef(true);
  const forbidden = denied.has(file.id);
  useEffect(() => {
    active.current = true;
    let cancelled = false;
    renewed.current = false;
    if (enabled && !forbidden) {
      read(file.id, "preview", attempt > 0)
        .then((value) => {
          if (!cancelled) {
            setSource(value);
            setError("");
          }
        })
        .catch((failure) => {
          if (!cancelled)
            setError(
              failure instanceof Error ? failure.message : "Could not reach the file. Try again.",
            );
        });
    }
    return () => {
      cancelled = true;
      active.current = false;
    };
  }, [file.id, enabled, forbidden, read, attempt]);
  const fail = useCallback((message: string) => setError(message), []);
  const renew = useCallback(async () => {
    if (renewed.current) {
      setError("The preview could not recover. Try again or download the original.");
      return;
    }
    renewed.current = true;
    try {
      const value = await read(file.id, "preview", true);
      if (active.current) {
        setError("");
        setSource(value);
      }
    } catch (failure) {
      if (active.current)
        setError(failure instanceof Error ? failure.message : "Could not renew access. Try again.");
    }
  }, [read, file.id]);
  return {
    source,
    error,
    forbidden,
    fail,
    renew,
    retry: () => {
      setSource(null);
      setError("");
      setAttempt((current) => current + 1);
    },
  };
}

export function PreviewFallback({
  file,
  message,
  retry,
}: {
  file: ViewFile;
  message?: string;
  retry?: () => void;
}) {
  return (
    <div className="mt-6 flex min-h-56 flex-col items-center justify-center gap-4 rounded-xl border border-border bg-card px-5 py-10 text-center">
      <FileIcon family={fileFamily(file)} className="size-12 text-muted-foreground" />
      <output className="max-w-prose text-sm text-muted-foreground">
        {message ??
          (!file.downloadUrl
            ? "This file is not available to view or download yet."
            : classifyFile(file).conflict
              ? "The file type and filename disagree. Download the original to open it."
              : "Preview is unavailable for this file. Download the original to open it.")}
      </output>
      {retry ? (
        <button className={fileActionClass} onClick={retry}>
          Retry preview
        </button>
      ) : null}
    </div>
  );
}

export function FilePreview({
  file,
  onNavigate,
  files,
  onOpen,
}: {
  file: ViewFile;
  onNavigate?: (direction: number) => void;
  files?: ViewFile[];
  onOpen?: (file: ViewFile) => void;
}) {
  const supported = ["image", "video", "audio", "markdown", "text", "pdf", "table"].includes(
    fileFamily(file),
  );
  const preview = usePreviewUrl(file, !!file.downloadUrl && supported);
  if (preview.forbidden)
    return (
      <PreviewFallback file={file} message="This file is no longer available through this link." />
    );
  if (preview.error)
    return <PreviewFallback file={file} message={preview.error} retry={preview.retry} />;
  if (supported && file.downloadUrl && !preview.source)
    return (
      <div className="mt-6 min-h-56 animate-pulse rounded-xl bg-card motion-reduce:animate-none">
        <output className="block p-6 text-sm text-muted-foreground">Preparing preview…</output>
      </div>
    );
  if (preview.source && fileFamily(file) === "image")
    return (
      <ImagePreview
        file={file}
        source={preview.source}
        fail={preview.fail}
        renew={preview.renew}
        onNavigate={onNavigate}
      />
    );
  if (preview.source && ["video", "audio"].includes(fileFamily(file)))
    return (
      <MediaPreview
        audio={fileFamily(file) === "audio"}
        file={file}
        source={preview.source}
        fail={preview.fail}
        renew={preview.renew}
      />
    );
  if (preview.source && ["markdown", "text"].includes(fileFamily(file)))
    return (
      <TextPreview
        file={file}
        source={preview.source}
        fail={preview.fail}
        renew={preview.renew}
        files={files ?? [file]}
        onOpen={onOpen}
      />
    );
  if (preview.source && fileFamily(file) === "pdf")
    return (
      <PDFPreview file={file} source={preview.source} fail={preview.fail} renew={preview.renew} />
    );
  if (preview.source && fileFamily(file) === "table")
    return (
      <TablePreview file={file} source={preview.source} fail={preview.fail} renew={preview.renew} />
    );
  return <PreviewFallback file={file} />;
}
