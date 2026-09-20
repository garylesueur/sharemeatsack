"use client";

import { useState } from "react";

type HomeLandingProps = {
  mcpUrl: string;
  cursorHref: string;
  pluginHref: string;
};

/** The interactive parts of the hero: connect, or curl it. */
export function HomeLanding({ mcpUrl, cursorHref, pluginHref }: HomeLandingProps) {
  const [copied, setCopied] = useState<"mcp" | null>(null);

  async function copy(kind: "mcp", value: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return;
    }
    setCopied(kind);
    window.setTimeout(() => {
      setCopied(null);
    }, 1500);
  }

  return (
    <>
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <a
          href={cursorHref}
          className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Add to Cursor
        </a>
        <a
          href={pluginHref}
          className="inline-flex rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground"
        >
          Cursor plugin
        </a>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <code className="max-w-full break-all rounded-md bg-muted px-2 py-1 font-mono text-sm text-foreground">
          {mcpUrl}
        </code>
        <button
          type="button"
          className="rounded-md border border-border px-3 py-1 text-sm text-foreground"
          onClick={() => {
            void copy("mcp", mcpUrl);
          }}
        >
          {copied === "mcp" ? "Copied" : "Copy MCP URL"}
        </button>
      </div>

      <p className="mt-3 text-sm text-muted-foreground">
        Paste that into any MCP client.{" "}
        <a
          href="https://grok.com/connectors"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-4 hover:text-foreground"
        >
          Grok connectors
        </a>
      </p>
    </>
  );
}

/** The raw API, for anyone who would rather not connect an agent at all. */
export function CurlBlock({ endpoint, curl }: { endpoint: string; curl: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(curl);
    } catch {
      return;
    }
    setCopied(true);
    window.setTimeout(() => {
      setCopied(false);
    }, 1500);
  }

  return (
    <div className="overflow-hidden rounded-xl border border-machine-rule bg-machine shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-machine-rule bg-machine-raised px-4 py-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.13em] text-machine-muted">
          {endpoint}
        </span>
        <button
          type="button"
          onClick={() => {
            void copy();
          }}
          className="rounded-md border border-machine-rule px-3 py-1 font-mono text-xs text-machine-foreground transition-colors hover:border-primary hover:text-primary"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto px-4 py-5 font-mono text-[12.5px] leading-[1.75] text-machine-foreground">
        {curl}
      </pre>
    </div>
  );
}
