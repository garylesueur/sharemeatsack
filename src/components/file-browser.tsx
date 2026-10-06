"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  defaultBrowserState,
  familyLabels,
  fileFamily,
  scanLabel,
  stateFromUrl,
  stateUrl,
  visibleFiles,
  type BrowserState,
  type ViewFile,
} from "@/lib/file-view";
import { FileDetails, FileDownload, FileIcon, fileActionClass } from "./file-parts";
import { PreviewBoundary } from "./preview-boundary";
import { useOverlaySurface } from "./overlay-surface";
import { FileThumbnail } from "./image-preview";
import { FilePreview } from "./file-preview";
import { FileSize } from "./file-size";

export function FileBrowser({
  files,
  title,
  message,
}: {
  files: ViewFile[];
  title?: string;
  message?: string;
}) {
  const [state, setState] = useState(() => defaultBrowserState(files));
  const [notice, setNotice] = useState("");
  const stage = useRef<HTMLElement>(null);
  const collectionHeading = useRef<HTMLParagraphElement>(null);
  const scroll = useRef(0);
  const previous = useRef<{ id: string; index: number } | null>(null);
  const matches = visibleFiles(files, state);
  const selected = files.find((file) => file.id === state.selected);
  const selectedId = selected?.id;
  const index = matches.findIndex((file) => file.id === state.selected);
  const families = [...new Set(files.map(fileFamily))];
  const multiple = files.length > 1;

  useOverlaySurface(stage, !!selectedId && multiple, "(max-width: 639px)");

  useEffect(() => {
    function restore() {
      const url = new URL(window.location.href);
      const restored = stateFromUrl(url, files);
      setNotice(
        url.searchParams.has("file") && url.searchParams.get("file") !== restored.selected
          ? "That file is no longer in this view. Choose a file below."
          : "",
      );
      setState(restored);
    }
    restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [files]);

  useEffect(() => {
    if (selectedId) stage.current?.focus({ preventScroll: true });
    else if (previous.current) {
      const button =
        document.getElementById(`file-${previous.current.id}`) ??
        document.getElementById(
          `file-${matches[Math.min(previous.current.index, matches.length - 1)]?.id}`,
        );
      window.scrollTo({ top: scroll.current });
      (button ?? collectionHeading.current)?.focus({ preventScroll: true });
    }
    previous.current = selectedId ? { id: selectedId, index: Math.max(0, index) } : null;
  }, [selectedId, matches, index]);

  const update = useCallback((next: BrowserState, push = false) => {
    const url = stateUrl(new URL(window.location.href), next);
    const history = {
      ...window.history.state,
      fileBrowserEntry: push || window.history.state?.fileBrowserEntry,
    };
    window.history[push ? "pushState" : "replaceState"](history, "", url);
    setState(next);
    setNotice("");
  }, []);
  function open(file: ViewFile) {
    scroll.current = window.scrollY;
    update({ ...state, selected: file.id }, true);
  }
  const close = useCallback(() => {
    if (!multiple) return;
    if (window.history.state?.fileBrowserEntry) window.history.back();
    else update({ ...state, selected: null });
  }, [multiple, state, update]);
  const navigate = useCallback(
    (direction: number) => {
      const file = matches[index + direction];
      if (file) update({ ...state, selected: file.id });
    },
    [matches, index, state, update],
  );
  useEffect(() => {
    if (!selectedId) return;
    const keyboard = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.defaultPrevented ||
        !(target instanceof HTMLElement) ||
        !stage.current?.contains(target)
      )
        return;
      if (event.key === "Escape") {
        close();
        return;
      }
      if (target !== stage.current && !target.hasAttribute("data-gallery-nav")) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        navigate(-1);
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        navigate(1);
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => document.removeEventListener("keydown", keyboard);
  }, [selectedId, close, navigate]);
  const control = `${fileActionClass} bg-background`;

  if (!files.length)
    return <p className="mt-4 text-sm text-muted-foreground">No files available in this view.</p>;
  return (
    <div className="mt-6 min-w-0">
      <output className="sr-only">
        {selected ? `Viewing ${selected.name}` : `${matches.length} of ${files.length} files`}
      </output>
      {notice ? (
        <output className="mb-4 block text-sm text-muted-foreground">{notice}</output>
      ) : null}
      {selected ? (
        <section
          ref={stage}
          tabIndex={-1}
          aria-label="File viewer"
          className={
            multiple
              ? "fixed inset-0 z-40 overflow-y-auto bg-background px-5 py-6 focus:outline-none sm:static sm:z-auto sm:overflow-visible sm:p-0"
              : "focus:outline-none"
          }
        >
          {multiple ? (
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <button className={control} onClick={close}>
                Back to files
              </button>
              <div className="flex items-center gap-2" aria-label="Collection navigation">
                <button
                  className={control}
                  data-gallery-nav=""
                  aria-label="Previous file"
                  disabled={index <= 0}
                  onClick={() => navigate(-1)}
                >
                  Previous
                </button>
                <span className="min-w-12 text-center text-sm tabular-nums text-muted-foreground">
                  {index + 1} / {matches.length}
                </span>
                <button
                  className={control}
                  data-gallery-nav=""
                  aria-label="Next file"
                  disabled={index < 0 || index >= matches.length - 1}
                  onClick={() => navigate(1)}
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
          {multiple && title ? (
            <div className="mb-5 sm:hidden">
              <p className="font-semibold break-words">{title}</p>
              {message ? (
                <p className="mt-1 text-sm text-muted-foreground break-words">{message}</p>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-center sm:gap-6">
            <FileDetails file={selected} />
            <FileDownload file={selected} />
          </div>
          {multiple ? (
            <nav aria-label="File filmstrip" className="mt-4 flex gap-2 overflow-x-auto pb-2">
              {matches.map((file) => (
                <button
                  key={file.id}
                  className={`${control} max-w-40 shrink-0 flex-col`}
                  aria-current={file.id === selected.id ? "true" : undefined}
                  aria-label={`View ${file.name}`}
                  data-gallery-nav=""
                  onClick={() => update({ ...state, selected: file.id })}
                >
                  {fileFamily(file) === "image" ? (
                    <FileThumbnail file={file} />
                  ) : (
                    <FileIcon family={fileFamily(file)} className="size-8" />
                  )}
                  <span className="max-w-32 truncate text-xs">{file.name}</span>
                </button>
              ))}
            </nav>
          ) : null}
          <PreviewBoundary key={selected.id} file={selected}>
            <FilePreview
              key={selected.id}
              file={selected}
              onNavigate={multiple ? navigate : undefined}
              files={files}
              onOpen={(file) => {
                const hidden = !matches.some((item) => item.id === file.id);
                update({ ...state, selected: file.id, search: "", filter: "all" });
                if (hidden) setNotice("Showing all files to open the attachment.");
              }}
            />
          </PreviewBoundary>
        </section>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
            <p
              ref={collectionHeading}
              tabIndex={-1}
              className="text-sm text-muted-foreground focus:outline-none"
            >
              {matches.length === files.length
                ? `${files.length} files`
                : `${matches.length} of ${files.length} files`}{" "}
              · <FileSize bytes={files.reduce((sum, file) => sum + file.size, 0)} />
            </p>
            <fieldset className="flex gap-2" aria-label="File view">
              <button
                className={control}
                aria-pressed={state.view === "list"}
                onClick={() => update({ ...state, view: "list" })}
              >
                List
              </button>
              <button
                className={control}
                aria-pressed={state.view === "grid"}
                onClick={() => update({ ...state, view: "grid" })}
              >
                Grid
              </button>
            </fieldset>
          </div>
          <div className="mb-5 flex flex-wrap gap-3">
            {files.length >= 10 ? (
              <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                Search files
                <input
                  className="min-h-11 w-full rounded-lg border border-border bg-background px-3 focus:outline-primary"
                  value={state.search}
                  maxLength={256}
                  placeholder="Search by filename"
                  onChange={(event) => update({ ...state, search: event.target.value })}
                />
              </label>
            ) : null}
            <label className="flex flex-col gap-1 text-sm">
              Sort
              <select
                className="min-h-11 rounded-lg border border-border bg-background px-3 focus:outline-primary"
                id="file-sort"
                value={state.sort}
                onChange={(event) =>
                  update({ ...state, sort: event.target.value as BrowserState["sort"] })
                }
              >
                <option value="offered">Original order</option>
                <option value="name">Name</option>
              </select>
            </label>
            {families.length > 1 ? (
              <label className="flex flex-col gap-1 text-sm">
                File type
                <select
                  className="min-h-11 rounded-lg border border-border bg-background px-3 focus:outline-primary"
                  id="file-filter"
                  value={state.filter}
                  onChange={(event) =>
                    update({ ...state, filter: event.target.value as BrowserState["filter"] })
                  }
                >
                  <option value="all">All files</option>
                  {families.map((family) => (
                    <option key={family} value={family}>
                      {familyLabels[family]}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          {!matches.length ? (
            <div className="py-12 text-center">
              <p>No files match this search.</p>
              <button
                className={`${control} mt-4`}
                onClick={() => update({ ...state, search: "", filter: "all" })}
              >
                Show all files
              </button>
            </div>
          ) : (
            <ul
              className={
                state.view === "grid"
                  ? "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
                  : "divide-y divide-border rounded-xl border border-border bg-card"
              }
            >
              {matches.map((file) => (
                <li
                  key={file.id}
                  className={
                    state.view === "grid"
                      ? "min-w-0 rounded-xl border border-border bg-card p-4"
                      : "flex min-w-0 flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-6 sm:p-5"
                  }
                >
                  <button
                    id={`file-${file.id}`}
                    className={`min-w-0 flex-1 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary ${state.view === "grid" ? "w-full" : "flex items-center gap-4"}`}
                    aria-label={`Open ${file.name}`}
                    onClick={() => open(file)}
                  >
                    {state.view === "grid" && fileFamily(file) === "image" ? (
                      <FileThumbnail file={file} />
                    ) : (
                      <FileIcon
                        family={fileFamily(file)}
                        className={
                          state.view === "grid"
                            ? "mx-auto my-5 size-12 text-muted-foreground"
                            : "size-8 shrink-0 text-muted-foreground"
                        }
                      />
                    )}
                    <div className="min-w-0">
                      <span className="block break-all text-sm font-medium leading-relaxed">
                        {file.name}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {familyLabels[fileFamily(file)]} · <FileSize bytes={file.size} />
                        <span className="mt-1 block">{scanLabel(file)}</span>
                      </span>
                    </div>
                  </button>
                  {state.view === "list" ? <FileDownload file={file} /> : null}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
