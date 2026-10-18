"use client";

import { useSyncExternalStore } from "react";
import { ColorModeToggle } from "./color-mode-toggle";
import {
  COLOR_MODE_STORAGE_KEY,
  applyResolvedColorMode,
  isStoredColorMode,
  persistColorModeCookie,
  type StoredColorMode,
} from "@/lib/color-mode";

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    media.removeEventListener("change", listener);
    window.removeEventListener("storage", listener);
  };
}

function readPreference(): StoredColorMode {
  const fromDom = document.documentElement.getAttribute("data-color-mode");
  if (isStoredColorMode(fromDom)) return fromDom;
  try {
    const stored = window.localStorage.getItem(COLOR_MODE_STORAGE_KEY);
    if (isStoredColorMode(stored)) return stored;
  } catch {
    // System preference still works when storage is unavailable.
  }
  return "auto";
}

function readIsDark(): boolean {
  const mode = readPreference();
  return (
    mode === "dark" ||
    (mode === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches)
  );
}

function applyPreference(mode: "light" | "dark"): void {
  applyResolvedColorMode(document.documentElement, mode, mode === "dark");
  try {
    window.localStorage.setItem(COLOR_MODE_STORAGE_KEY, mode);
    document.cookie = persistColorModeCookie(
      mode,
      window.location.hostname,
      window.location.protocol,
    );
  } catch {
    // A blocked store still applies for this page.
  }
  emit();
}

export function ColorModePicker({ className = "" }: { className?: string }) {
  const isDark = useSyncExternalStore(subscribe, readIsDark, () => false);
  return (
    <ColorModeToggle
      isDark={isDark}
      className={className}
      onToggle={() => applyPreference(isDark ? "light" : "dark")}
    />
  );
}
