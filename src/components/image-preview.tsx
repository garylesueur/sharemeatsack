"use client";
/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- The image scroll area supports keyboard panning. */
import { useCallback, useEffect, useRef, useState } from "react";
import { fileExtension, type ViewFile } from "@/lib/file-view";
import { animationCandidate, imageType, safeImageBlob } from "@/lib/image-preview";
import { imageSlot, readPreviewBytes, shouldRenew } from "@/lib/preview-bytes";
import { type ReadUrl } from "@/lib/file-access";
import { useOverlaySurface } from "./overlay-surface";
import { useFileAccess } from "./file-access";
import { FileIcon, fileActionClass } from "./file-parts";

export { animationCandidate };

function useImageBlob(
  file: ViewFile,
  source: ReadUrl | null,
  enabled: boolean,
  fail: (message: string) => void,
  renew?: () => Promise<unknown>,
) {
  const [blob, setBlob] = useState<{ source: string; url: string } | null>(null);
  useEffect(() => {
    if (!source || !enabled) return;
    const controller = new AbortController();
    let objectUrl = "";
    imageSlot(controller.signal, async () => {
      const bytes = await readPreviewBytes(source.url, 100 * 1024 * 1024, controller.signal);
      controller.signal.throwIfAborted();
      objectUrl = URL.createObjectURL(safeImageBlob(bytes, imageType(file)));
      setBlob({ source: source.url, url: objectUrl });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      if (renew && shouldRenew(error, source.expiresAt)) void renew();
      else fail(error instanceof Error ? error.message : "This image could not be loaded.");
    });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source, enabled, file, fail, renew]);
  return blob?.source === source?.url ? blob?.url : undefined;
}

export function ImagePreview({
  file,
  source,
  fail,
  renew,
  onNavigate,
}: {
  file: ViewFile;
  source: ReadUrl;
  fail: (message: string) => void;
  renew: () => Promise<unknown>;
  onNavigate?: (direction: number) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [expanded, setExpanded] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [motion, setMotion] = useState<boolean | null>(null);
  const expandedSurface = useRef<HTMLElement>(null);
  useOverlaySurface(expandedSurface, expanded);
  const container = useRef<HTMLElement>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setMotion(media.matches);
    change();
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (!expanded) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setExpanded(false);
      }
    };
    document.addEventListener("keydown", escape, true);
    return () => document.removeEventListener("keydown", escape, true);
  }, [expanded]);
  const animated = animationCandidate(file);
  const permitted = motion !== null && (!animated || !motion || playing);
  const blob = useImageBlob(file, source, permitted && file.size <= 100 * 1024 * 1024, fail, renew);
  if (file.size > 100 * 1024 * 1024)
    return (
      <p className="mt-6">Image preview is limited to 100 MiB. Download the original to open it.</p>
    );
  return (
    <section
      ref={expandedSurface}
      tabIndex={-1}
      aria-label="Image preview"
      className={expanded ? "fixed inset-0 z-50 flex flex-col bg-background p-5" : "mt-6"}
    >
      <div className="mb-3 flex flex-wrap gap-2">
        <button
          className={fileActionClass}
          disabled={zoom <= 1}
          onClick={() => setZoom(Math.max(1, zoom - 0.5))}
        >
          Zoom out
        </button>
        <button
          className={fileActionClass}
          disabled={zoom >= 4}
          onClick={() => setZoom(Math.min(4, zoom + 0.5))}
        >
          Zoom in
        </button>
        <button className={fileActionClass} onClick={() => setZoom(1)}>
          Fit image
        </button>
        <button
          className={fileActionClass}
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Exit expanded view" : "Expand image"}
        </button>
      </div>
      {animated ? (
        <p className="mb-3 text-sm text-muted-foreground">
          Animation-capable image{motion ? " · Reduced motion is enabled" : ""}
        </p>
      ) : null}
      {!permitted && animated ? (
        <button className={fileActionClass} onClick={() => setPlaying(true)}>
          Play animation
        </button>
      ) : (
        <section
          ref={container}
          aria-label="Image pan area"
          tabIndex={0}
          className={`min-h-56 overflow-auto rounded-xl border border-border bg-card ${expanded ? "min-h-0 flex-1" : "max-h-[70vh]"}`}
          onPointerDown={(event) => {
            if (zoom === 1 && event.pointerType === "touch")
              swipe.current = { x: event.clientX, y: event.clientY };
            if (zoom > 1 && container.current) {
              pan.current = {
                x: event.clientX,
                y: event.clientY,
                left: container.current.scrollLeft,
                top: container.current.scrollTop,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }
          }}
          onPointerMove={(event) => {
            if (pan.current && container.current) {
              container.current.scrollLeft = pan.current.left + pan.current.x - event.clientX;
              container.current.scrollTop = pan.current.top + pan.current.y - event.clientY;
            }
          }}
          onPointerUp={(event) => {
            if (
              swipe.current &&
              zoom === 1 &&
              Math.abs(event.clientX - swipe.current.x) > 70 &&
              Math.abs(event.clientY - swipe.current.y) < 50
            )
              onNavigate?.(event.clientX < swipe.current.x ? 1 : -1);
            swipe.current = null;
            pan.current = null;
          }}
          onPointerCancel={() => {
            pan.current = null;
          }}
          style={{ touchAction: zoom > 1 ? "none" : "pan-y" }}
        >
          {blob ? (
            <img
              src={blob}
              alt={file.name}
              draggable={false}
              className="mx-auto block object-contain"
              style={
                zoom === 1
                  ? { maxWidth: "100%", maxHeight: expanded ? "calc(100dvh - 120px)" : "70vh" }
                  : { width: `${zoom * 100}%`, maxWidth: "none" }
              }
              onError={() =>
                fail("This image cannot be decoded by this browser. Download the original.")
              }
            />
          ) : (
            <output className="block p-6 text-sm text-muted-foreground">Loading image…</output>
          )}
        </section>
      )}
    </section>
  );
}

export function FileThumbnail({ file }: { file: ViewFile }) {
  const { read } = useFileAccess();
  const element = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [source, setSource] = useState<ReadUrl | null>(null);
  const [failed, setFailed] = useState(false);
  const eligible =
    !!file.downloadUrl &&
    file.size <= 2 * 1024 * 1024 &&
    !animationCandidate(file) &&
    !["svg", "tiff", "heic"].includes(fileExtension(file));
  useEffect(() => {
    if (!eligible || !element.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setVisible(entry.isIntersecting);
      },
      { rootMargin: "150px" },
    );
    observer.observe(element.current);
    return () => observer.disconnect();
  }, [eligible]);
  useEffect(() => {
    let cancelled = false;
    if (eligible && visible)
      read(file.id, "preview")
        .then((value) => {
          if (!cancelled) setSource(value);
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    return () => {
      cancelled = true;
    };
  }, [eligible, visible, file.id, read]);
  const fail = useCallback(() => setFailed(true), []);
  const blob = useImageBlob(file, source, eligible && visible && !failed, fail);
  return (
    <span
      ref={element}
      className="flex h-24 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted/30"
    >
      {blob && !failed ? (
        <img src={blob} alt="" className="h-full w-full object-contain" onError={fail} />
      ) : (
        <FileIcon family="image" className="size-10 text-muted-foreground" />
      )}
    </span>
  );
}
