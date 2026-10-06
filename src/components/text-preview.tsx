"use client";

// Each focusable container scrolls independently with the keyboard. Index keys
// describe immutable source line/token positions within this selected file.
/* oxlint-disable jsx-a11y/no-noninteractive-tabindex, react/no-array-index-key */
// react-markdown's components API requires callbacks closing over this
// selected document's authorised attachment collection.
/* oxlint-disable react/no-unstable-nested-components */

import { Children, isValidElement, useEffect, useRef, useState, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Highlight, Prism } from "prism-react-renderer";
import { type ReadUrl } from "@/lib/file-access";
import { fileFamily, type ViewFile } from "@/lib/file-view";
import { readPreviewBytes, shouldRenew } from "@/lib/preview-bytes";
import {
  decodeTextPreview,
  completeLineStop,
  markdownTarget,
  sourceLanguage,
  TEXT_BYTE_LIMIT,
  type TextPreview as Preview,
} from "@/lib/text-preview";
import { useFileAccess } from "./file-access";
import { animationCandidate, FileThumbnail } from "./image-preview";
import { fileActionClass } from "./file-parts";

function nodeText(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) =>
      isValidElement<{ children?: ReactNode }>(child)
        ? nodeText(child.props.children)
        : String(child),
    )
    .join("");
}
function headingSlug(children: ReactNode) {
  return nodeText(children)
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, "-");
}

export function SourceCode({
  text,
  language,
  numbered = false,
}: {
  text: string;
  language: string;
  numbered?: boolean;
}) {
  // Long bounded files remain readable without applying expensive grammar work
  // to every character. Unknown languages also retain literal source text.
  const highlight = text.length <= 100_000 && !!Prism.languages[language];
  return (
    <div
      className="max-w-full overflow-x-auto rounded-lg border border-border bg-card p-4 text-sm"
      tabIndex={0}
      aria-label="Source code"
    >
      {highlight ? (
        <Highlight code={text.replace(/\n$/, "")} language={language}>
          {({ tokens, getTokenProps }) => (
            <pre className="m-0 font-mono leading-6">
              {tokens.map((line, index) => (
                <div key={index} className="flex min-w-max">
                  {numbered ? (
                    <span
                      aria-hidden="true"
                      className="mr-4 w-12 shrink-0 select-none text-right text-muted-foreground"
                    >
                      {index + 1}
                    </span>
                  ) : null}
                  <code>
                    {line.map((token, tokenIndex) => (
                      <span
                        key={tokenIndex}
                        {...getTokenProps({ token })}
                        style={undefined}
                        className={
                          token.types.includes("comment")
                            ? "italic text-muted-foreground"
                            : token.types.includes("keyword")
                              ? "font-semibold text-foreground"
                              : token.types.includes("string")
                                ? "text-foreground underline decoration-border underline-offset-4"
                                : "text-foreground"
                        }
                      />
                    ))}
                  </code>
                </div>
              ))}
            </pre>
          )}
        </Highlight>
      ) : (
        <pre className="m-0 font-mono leading-6">
          {text
            .replace(/\n$/, "")
            .split("\n")
            .map((line, index) => (
              <div key={index} className="flex min-w-max">
                {numbered ? (
                  <span
                    aria-hidden="true"
                    className="mr-4 w-12 shrink-0 select-none text-right text-muted-foreground"
                  >
                    {index + 1}
                  </span>
                ) : null}
                <code>{line || " "}</code>
              </div>
            ))}
        </pre>
      )}
    </div>
  );
}

export function TextPreview({
  file,
  source,
  fail,
  renew,
  files,
  onOpen,
}: {
  file: ViewFile;
  source: ReadUrl;
  fail: (message: string) => void;
  renew: () => Promise<unknown>;
  files: ViewFile[];
  onOpen?: (file: ViewFile) => void;
}) {
  const [content, setContent] = useState<{ source: string; value: Preview } | null>(null);
  const [mode, setMode] = useState<"rendered" | "source">("rendered");
  const [copyStatus, setCopyStatus] = useState("");
  const reader = useRef<HTMLDivElement>(null);
  const positions = useRef({ rendered: 0, source: 0 });
  const { denied } = useFileAccess();
  const markdown = fileFamily(file) === "markdown";
  useEffect(() => {
    const controller = new AbortController();
    let fetched = false;
    readPreviewBytes(source.url, TEXT_BYTE_LIMIT, controller.signal, completeLineStop())
      .then((bytes) => {
        controller.signal.throwIfAborted();
        fetched = true;
        setContent({ source: source.url, value: decodeTextPreview(bytes, file.size) });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (!fetched && shouldRenew(error, source.expiresAt)) void renew();
        else fail(error instanceof Error ? error.message : "This text could not be loaded.");
      });
    return () => controller.abort();
  }, [file.size, source, fail, renew]);
  const preview = content?.source === source.url ? content.value : null;
  const target = (url: string | undefined) => {
    const resolved = markdownTarget(url, files);
    return resolved.kind === "attachment" && denied.has(resolved.file.id)
      ? { kind: "unavailable" as const }
      : resolved;
  };
  const heading = (level: number, children: ReactNode) => {
    const id = `reader-${file.id}-${headingSlug(children)}`;
    const className = "mb-4 mt-7 scroll-mt-4 font-bold leading-tight";
    switch (level) {
      case 1:
        return (
          <h1 id={id} className={`${className} text-3xl`}>
            {children}
          </h1>
        );
      case 2:
        return (
          <h2 id={id} className={`${className} text-2xl`}>
            {children}
          </h2>
        );
      case 3:
        return (
          <h3 id={id} className={`${className} text-xl`}>
            {children}
          </h3>
        );
      case 4:
        return (
          <h4 id={id} className={className}>
            {children}
          </h4>
        );
      case 5:
        return (
          <h5 id={id} className={className}>
            {children}
          </h5>
        );
      default:
        return (
          <h6 id={id} className={className}>
            {children}
          </h6>
        );
    }
  };
  if (!preview)
    return <output className="mt-6 block p-6 text-sm text-muted-foreground">Loading text…</output>;
  return (
    <section className="mt-6 min-w-0" aria-label={markdown ? "Markdown reader" : "Source reader"}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {markdown ? (
          <fieldset className="flex gap-2" aria-label="Markdown view">
            {(["rendered", "source"] as const).map((value) => (
              <button
                key={value}
                className={fileActionClass}
                aria-pressed={mode === value}
                onClick={() => {
                  if (reader.current) positions.current[mode] = reader.current.scrollTop;
                  setMode(value);
                  requestAnimationFrame(() => {
                    if (reader.current) reader.current.scrollTop = positions.current[value];
                  });
                }}
              >
                {value === "rendered" ? "Rendered" : "Source"}
              </button>
            ))}
          </fieldset>
        ) : null}
        <button
          className={fileActionClass}
          onClick={() => {
            if (!navigator.clipboard) {
              setCopyStatus(
                "Copy is unavailable in this browser. Select the source text to copy it.",
              );
              return;
            }
            navigator.clipboard.writeText(preview.text).then(
              () =>
                setCopyStatus(
                  preview.partial ? "Truncated preview copied." : "Full preview copied.",
                ),
              () =>
                setCopyStatus(
                  "Copy is unavailable in this browser. Select the source text to copy it.",
                ),
            );
          }}
        >
          {preview.partial ? "Copy truncated preview" : "Copy full preview"}
        </button>
        <span className="text-xs text-muted-foreground">
          {preview.encoding} · {preview.lines.toLocaleString("en-GB")} lines
        </span>
      </div>
      <output className="mb-3 block text-sm text-muted-foreground">{copyStatus}</output>
      {preview.partial ? (
        <p className="mb-4 rounded-lg border border-border bg-card p-3 text-sm">
          Partial preview: limited to the first 1 MiB and 10,000 complete lines. An incomplete final
          line is omitted. Download the original for the complete file.
        </p>
      ) : null}
      <div
        ref={reader}
        className="max-h-[70vh] min-w-0 overflow-auto rounded-xl border border-border bg-card p-4 sm:p-6"
        tabIndex={0}
        aria-label="Reading area"
      >
        {markdown && mode === "rendered" ? (
          <article className="mx-auto max-w-prose break-words leading-7">
            <Markdown
              skipHtml
              remarkPlugins={[remarkGfm]}
              urlTransform={(url) => url}
              components={{
                h1: ({ children }) => heading(1, children),
                h2: ({ children }) => heading(2, children),
                h3: ({ children }) => heading(3, children),
                h4: ({ children }) => heading(4, children),
                h5: ({ children }) => heading(5, children),
                h6: ({ children }) => heading(6, children),
                p: ({ children }) => <p className="my-4">{children}</p>,
                ul: ({ children }) => <ul className="my-4 list-disc space-y-1 pl-6">{children}</ul>,
                ol: ({ children }) => (
                  <ol className="my-4 list-decimal space-y-1 pl-6">{children}</ol>
                ),
                blockquote: ({ children }) => (
                  <blockquote className="my-4 border-l-4 border-border pl-4 text-muted-foreground">
                    {children}
                  </blockquote>
                ),
                table: ({ children }) => (
                  <div
                    className="my-4 max-w-full overflow-x-auto"
                    tabIndex={0}
                    aria-label="Markdown table"
                  >
                    <table className="w-full border-collapse text-sm">{children}</table>
                  </div>
                ),
                th: ({ children }) => (
                  <th className="border border-border bg-muted/30 px-3 py-2 text-left">
                    {children}
                  </th>
                ),
                td: ({ children }) => (
                  <td className="border border-border px-3 py-2">{children}</td>
                ),
                pre: ({ children }) => <div className="my-4">{children}</div>,
                code: ({ className, children, node }) => {
                  const language = /language-([\w-]+)/.exec(className ?? "")?.[1];
                  return language || node?.position?.start.line !== node?.position?.end.line ? (
                    <SourceCode text={nodeText(children)} language={language ?? "plain"} />
                  ) : (
                    <code className="rounded bg-muted/40 px-1 font-mono text-sm">{children}</code>
                  );
                },
                a: ({ href, children }) => {
                  const resolved = target(href);
                  if (resolved.kind === "attachment")
                    return (
                      <button
                        className="min-h-11 break-all text-left underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
                        onClick={() => onOpen?.(resolved.file)}
                      >
                        {children} <span className="text-xs">(open attachment)</span>
                      </button>
                    );
                  if (resolved.kind === "anchor")
                    return (
                      <button
                        className="min-h-11 text-left underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
                        onClick={() => {
                          let anchor: string;
                          try {
                            anchor = decodeURIComponent(resolved.url.slice(1));
                          } catch {
                            return;
                          }
                          const id = `reader-${file.id}-${anchor}`;
                          const element = document.getElementById(id);
                          if (element && reader.current?.contains(element))
                            element.scrollIntoView({ block: "start", behavior: "instant" });
                        }}
                      >
                        {children}
                      </button>
                    );
                  if (resolved.kind === "external")
                    return (
                      <a
                        className="inline-flex min-h-11 items-center break-all underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
                        href={resolved.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        referrerPolicy="no-referrer"
                      >
                        {children}
                      </a>
                    );
                  return (
                    <span className="text-muted-foreground">
                      {children} <span className="text-xs">(link unavailable)</span>
                    </span>
                  );
                },
                img: ({ src, alt }) => {
                  const resolved = target(typeof src === "string" ? src : undefined);
                  if (resolved.kind === "external" && /^https?:/i.test(resolved.url))
                    return (
                      <a
                        className="inline-flex min-h-11 items-center break-all underline underline-offset-4"
                        href={resolved.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        referrerPolicy="no-referrer"
                      >
                        External image: {alt || resolved.url}
                      </a>
                    );
                  if (resolved.kind !== "attachment" || fileFamily(resolved.file) !== "image")
                    return (
                      <span className="rounded border border-border p-2 text-sm text-muted-foreground">
                        Image unavailable:{" "}
                        {alt || (typeof src === "string" ? src : "unnamed image")}
                      </span>
                    );
                  const image = resolved.file;
                  return (
                    <button
                      className="my-2 inline-flex min-h-11 max-w-full flex-col gap-2 rounded-lg border border-border p-3 text-left focus-visible:outline-2 focus-visible:outline-ring"
                      onClick={() => onOpen?.(image)}
                    >
                      {!animationCandidate(image) && image.size <= 2 * 1024 * 1024 ? (
                        <FileThumbnail file={image} />
                      ) : null}
                      <span className="break-all text-sm">
                        {alt || image.name} ·{" "}
                        {animationCandidate(image) ? "Open animation" : "Open image"}
                      </span>
                    </button>
                  );
                },
              }}
            >
              {preview.text}
            </Markdown>
          </article>
        ) : (
          <SourceCode text={preview.text} language={sourceLanguage(file)} numbered />
        )}
      </div>
    </section>
  );
}
