"use client";

import { useEffect, useId, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  copyPublicLink,
  publicEmailLink,
  shareLinkAvailable,
  sharePublicLink,
  type PublicShareLink,
} from "@/lib/public-sharing";
import { fileActionClass } from "./file-parts";

const subscribeDevice = () => () => {};
const deviceShareSupported = () => typeof navigator.share === "function";
const serverDeviceShareSupported = () => false;

export function TransferProductEntry() {
  return (
    <p className="text-sm text-muted-foreground">
      Send or request files with your agent.{" "}
      <a
        className="font-medium text-foreground underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
        href="/install"
      >
        Use share.imeatsack.com
      </a>{" "}
      You can finish this transfer without signing in.
    </p>
  );
}

export function PublicTransferSave({ href, link }: { href: string; link: PublicShareLink }) {
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      clearTimeout(timer);
      const available = shareLinkAvailable(link);
      setExpired(!available);
      if (available)
        timer = setTimeout(
          check,
          Math.min(Date.parse(link.expiresAt) - Date.now() + 1, 2_147_483_647),
        );
    };
    timer = setTimeout(check, 0);
    window.addEventListener("focus", check);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", check);
    };
  }, [link]);
  if (expired) return null;
  return (
    <a
      className={fileActionClass}
      href={href}
      referrerPolicy="no-referrer"
      onClick={(event) => {
        if (!shareLinkAvailable(link)) {
          event.preventDefault();
          setExpired(true);
        }
      }}
    >
      Save to my account
    </a>
  );
}

export function PublicTransferSharing({
  link,
  unavailableReason,
  saveEntry,
}: {
  link?: PublicShareLink;
  unavailableReason?: string;
  saveEntry?: ReactNode;
}) {
  const inputId = useId();
  const [expired, setExpired] = useState(false);
  const deviceSupported = useSyncExternalStore(
    subscribeDevice,
    deviceShareSupported,
    serverDeviceShareSupported,
  );
  const [busy, setBusy] = useState<"copy" | "device" | null>(null);
  const [notice, setNotice] = useState("");
  const [fallback, setFallback] = useState(false);
  useEffect(() => {
    if (!link) return;
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      clearTimeout(timer);
      const available = shareLinkAvailable(link);
      setExpired(!available);
      if (available)
        timer = setTimeout(
          check,
          Math.min(Date.parse(link.expiresAt) - Date.now() + 1, 2_147_483_647),
        );
    };
    timer = setTimeout(check, 0);
    window.addEventListener("focus", check);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", check);
    };
  }, [link]);
  const available = !!link && !expired;
  const emailUrl = link && available ? publicEmailLink(link) : null;
  async function copy() {
    if (!link) return;
    setBusy("copy");
    setNotice("");
    const result = await copyPublicLink(link, navigator.clipboard);
    setBusy(null);
    if (result === "unavailable") {
      setExpired(true);
      return;
    }
    setFallback(result !== "copied");
    setNotice(
      result === "copied"
        ? "Link copied."
        : "The browser could not copy the link. Select it below and copy it, or retry.",
    );
  }
  async function deviceShare() {
    if (!link) return;
    setBusy("device");
    setNotice("");
    const result = await sharePublicLink(
      link,
      typeof navigator.share === "function"
        ? {
            share: (data) => navigator.share(data),
            canShare: navigator.canShare ? (data) => navigator.canShare(data) : undefined,
          }
        : undefined,
    );
    setBusy(null);
    if (result === "unavailable") {
      setExpired(true);
      return;
    }
    setFallback(result === "failed" || result === "unsupported");
    setNotice(
      result === "completed"
        ? "Device sharing completed. Delivery is handled by your chosen app."
        : result === "cancelled"
          ? "Sharing cancelled. You can try again."
          : "Device sharing could not open. Copy the link below or use email.",
    );
  }
  return (
    <div className="my-5 space-y-3">
      {available ? (
        <>
          <p className="text-sm text-muted-foreground">
            Anyone with this link can access the available files until it expires.
          </p>
          <div className="flex flex-wrap gap-2" aria-label="Share this transfer">
            <button className={fileActionClass} disabled={!!busy} onClick={copy}>
              {busy === "copy" ? "Copying…" : "Copy link"}
            </button>
            {deviceSupported ? (
              <button className={fileActionClass} disabled={!!busy} onClick={deviceShare}>
                {busy === "device" ? "Sharing…" : "Share"}
              </button>
            ) : null}
            {emailUrl ? (
              <a
                className={fileActionClass}
                href={emailUrl}
                onClick={(event) => {
                  if (!link || !shareLinkAvailable(link)) {
                    event.preventDefault();
                    setExpired(true);
                    return;
                  }
                  setNotice(
                    "Email handoff requested. Your email app decides whether to open a draft; nothing has been sent by share.imeatsack.com.",
                  );
                }}
              >
                Email link
              </a>
            ) : null}
            {saveEntry}
          </div>
          {fallback && link ? (
            <div className="space-y-2">
              <label className="block text-sm font-medium" htmlFor={inputId}>
                Public transfer link
              </label>
              <input
                id={inputId}
                className="min-h-11 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-sm focus:outline-primary"
                value={link.url}
                readOnly
                onFocus={(event) => event.currentTarget.select()}
              />
              <button className={fileActionClass} disabled={!!busy} onClick={copy}>
                Retry copy
              </button>
            </div>
          ) : null}
          <output className="block text-sm text-muted-foreground" aria-live="polite">
            {notice}
          </output>
        </>
      ) : (
        <output className="block text-sm text-muted-foreground">
          Sharing is unavailable.{" "}
          {expired
            ? "This link has expired."
            : (unavailableReason ?? "The files are not available to share.")}{" "}
          Sharing a link cannot reopen this transfer.
        </output>
      )}
      <TransferProductEntry />
    </div>
  );
}
