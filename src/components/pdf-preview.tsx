"use client";

// The scroll area is deliberately focusable for keyboard panning at zoom.
/* oxlint-disable jsx-a11y/no-noninteractive-tabindex */

import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import { type ReadUrl } from "@/lib/file-access";
import { type ViewFile } from "@/lib/file-view";
import { PDF_BYTE_LIMIT, PDF_PAGE_LIMIT, PDF_PIXEL_LIMIT, pdfRaster } from "@/lib/pdf-preview";
import { readPreviewBytes, shouldRenew } from "@/lib/preview-bytes";
import { fileActionClass } from "./file-parts";

const assets = `/_preview/pdfjs/${pdfjs.version}/`;
pdfjs.GlobalWorkerOptions.workerSrc = `${assets}pdf.worker.min.mjs`;

export function PDFPreview({
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
  const [loaded, setLoaded] = useState<{ source: string; document: pdfjs.PDFDocumentProxy } | null>(
    null,
  );
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(320);
  const [rendered, setRendered] = useState("");
  const [limited, setLimited] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const activeRender = useRef<pdfjs.RenderTask | null>(null);
  const renderQueue = useRef(Promise.resolve());
  const document = loaded?.source === source.url ? loaded.document : null;
  const page = Math.min(pageNumber, document?.numPages ?? pageNumber);
  const renderKey = `${source.url}:${page}:${zoom}:${width}`;

  useEffect(() => {
    const controller = new AbortController();
    let task: pdfjs.PDFDocumentLoadingTask | undefined;
    let parseTimer: ReturnType<typeof setTimeout> | undefined;
    let fetched = false;
    async function load() {
      if (file.size > PDF_BYTE_LIMIT) {
        fail(
          "PDF preview is limited to files of 50 MiB or less. Download the original to read it.",
        );
        return;
      }
      try {
        // Current R2 CORS exposes ETag only. A single bounded direct-storage
        // read avoids relying on inaccessible range metadata in PDF.js.
        const bytes = await readPreviewBytes(source.url, PDF_BYTE_LIMIT, controller.signal);
        controller.signal.throwIfAborted();
        if (bytes.length !== file.size)
          throw new Error("The complete PDF could not be loaded. Download the original or retry.");
        fetched = true;
        task = pdfjs.getDocument({
          data: bytes,
          // PDF.js 6 removed eval and the former isEvalSupported option.
          enableXfa: false,
          stopAtErrors: true,
          maxImageSize: PDF_PIXEL_LIMIT,
          canvasMaxAreaInBytes: PDF_PIXEL_LIMIT * 4,
          cMapUrl: `${assets}cmaps/`,
          standardFontDataUrl: `${assets}standard_fonts/`,
          wasmUrl: `${assets}wasm/`,
          iccUrl: `${assets}iccs/`,
          verbosity: pdfjs.VerbosityLevel.ERRORS,
        });
        parseTimer = setTimeout(() => {
          if (!controller.signal.aborted) {
            fail("This PDF took too long to open. Retry or download the original.");
            void task?.destroy().catch(() => {});
          }
        }, 30_000);
        const value = await task.promise;
        clearTimeout(parseTimer);
        controller.signal.throwIfAborted();
        if (value.numPages > PDF_PAGE_LIMIT) {
          fail("PDF preview is limited to 500 pages. Download the original to read this document.");
          await task.destroy();
          return;
        }
        setLoaded({ source: source.url, document: value });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof Error && error.name === "PasswordException")
          fail("This PDF is password protected. Download the original to open it privately.");
        else if (!fetched && shouldRenew(error, source.expiresAt)) void renew();
        else if (!fetched)
          fail(
            error instanceof Error
              ? error.message
              : "The PDF could not be loaded from storage. Retry or download the original.",
          );
        else
          fail(
            "This PDF could not be previewed. It may be corrupt or unsupported. Download the original to open it.",
          );
      } finally {
        clearTimeout(parseTimer);
      }
    }
    void load();
    return () => {
      controller.abort();
      clearTimeout(parseTimer);
      activeRender.current?.cancel();
      void task?.destroy().catch(() => {});
    };
  }, [file.size, source, fail, renew]);

  useEffect(() => {
    const element = area.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(1, entry.contentRect.width - 24)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!document) return;
    let cancelled = false;
    let ownTask: pdfjs.RenderTask | undefined;
    let canvas: HTMLCanvasElement | undefined;
    let settled = false;
    let cancelLoad: (() => void) | undefined;
    // Wait for a cancelled render to settle before allocating the next canvas.
    // Rapid changes cannot render onto the same canvas or accumulate surfaces.
    renderQueue.current = renderQueue.current
      .catch(() => {})
      .then(async () => {
        if (cancelled) return;
        let pdfPage: pdfjs.PDFPageProxy | undefined;
        let renderTimer: ReturnType<typeof setTimeout> | undefined;
        let timedOut = false;
        try {
          const timeout = new Promise<never>((_, reject) => {
            cancelLoad = () => reject(new Error("PDF page loading cancelled."));
            renderTimer = setTimeout(() => {
              timedOut = true;
              if (!cancelled) {
                fail("This PDF page took too long to render. Download the original or retry.");
                ownTask?.cancel();
              }
              reject(new Error("PDF page loading timed out."));
            }, 30_000);
          });
          pdfPage = await Promise.race([
            document.getPage(page).then((value) => {
              if (timedOut || cancelled) value.cleanup();
              return value;
            }),
            timeout,
          ]);
          if (cancelled) return;
          const original = pdfPage.getViewport({ scale: 1 });
          const raster = pdfRaster(
            original.width,
            original.height,
            width,
            zoom,
            window.devicePixelRatio,
          );
          canvas = window.document.createElement("canvas");
          canvas.width = raster.width;
          canvas.height = raster.height;
          canvas.style.width = `${raster.cssWidth}px`;
          canvas.style.height = `${raster.cssHeight}px`;
          canvas.className = "mx-auto block bg-white";
          canvas.setAttribute("role", "img");
          canvas.setAttribute("aria-label", `Page ${page} of ${document.numPages} in ${file.name}`);
          surface.current?.replaceChildren(canvas);
          setLimited(raster.limited);
          ownTask = pdfPage.render({
            canvas,
            viewport: pdfPage.getViewport({ scale: raster.scale }),
            annotationMode: pdfjs.AnnotationMode.DISABLE,
          });
          activeRender.current = ownTask;
          await ownTask.promise;
          if (!cancelled) setRendered(renderKey);
        } catch (error) {
          if (
            !cancelled &&
            !timedOut &&
            !(error instanceof Error && error.name === "RenderingCancelledException")
          )
            fail("This PDF page could not be rendered. Download the original to read it.");
        } finally {
          clearTimeout(renderTimer);
          if (activeRender.current === ownTask) activeRender.current = null;
          pdfPage?.cleanup();
          settled = true;
          if (cancelled && canvas) {
            canvas.remove();
            canvas.width = 0;
            canvas.height = 0;
          }
        }
      });
    return () => {
      cancelled = true;
      cancelLoad?.();
      ownTask?.cancel();
      if (settled && canvas) {
        canvas.remove();
        canvas.width = 0;
        canvas.height = 0;
      }
    };
  }, [document, page, zoom, width, file.name, fail, renderKey]);

  return (
    <section aria-label="PDF reader" className="mt-6 min-w-0">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <fieldset aria-label="PDF pages" className="flex flex-wrap items-center gap-2">
          <button
            className={fileActionClass}
            disabled={!document || page <= 1}
            onClick={() => setPageNumber(page - 1)}
          >
            Previous page
          </button>
          <output className="px-2 text-sm">
            {document ? `Page ${page} of ${document.numPages}` : "Opening PDF…"}
          </output>
          <button
            className={fileActionClass}
            disabled={!document || page >= document.numPages}
            onClick={() => setPageNumber(page + 1)}
          >
            Next page
          </button>
        </fieldset>
        <fieldset aria-label="PDF zoom" className="flex flex-wrap items-center gap-2">
          <button
            className={fileActionClass}
            disabled={!document || zoom <= 0.25}
            onClick={() => setZoom(Math.max(0.25, zoom - 0.25))}
          >
            Zoom out
          </button>
          <button className={fileActionClass} disabled={!document} onClick={() => setZoom(1)}>
            Fit page width
          </button>
          <button
            className={fileActionClass}
            disabled={!document || zoom >= 4}
            onClick={() => setZoom(Math.min(4, zoom + 0.25))}
          >
            Zoom in
          </button>
          <span className="px-2 text-sm">
            {Math.round(zoom * 100)}%{limited ? " · resolution limited" : ""}
          </span>
        </fieldset>
      </div>
      <output className="mb-2 block text-sm text-muted-foreground">
        {document && rendered !== renderKey ? `Rendering page ${page}…` : ""}
      </output>
      <p className="mb-3 text-xs text-muted-foreground">
        PDF preview omits interactive forms, annotations and embedded images above 16 megapixels.
        Download the original for the complete document.
      </p>
      <div
        ref={area}
        className="max-h-[70vh] max-w-full overflow-auto rounded-xl border border-border bg-muted/30 p-3 focus-visible:outline-2 focus-visible:outline-ring"
        tabIndex={0}
        aria-label="PDF page scroll area"
      >
        <div ref={surface} className="min-h-56" />
      </div>
    </section>
  );
}
