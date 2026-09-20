"use client";

import { useSyncExternalStore } from "react";
import {
  COLOR_MODES,
  COLOR_MODE_STORAGE_KEY,
  applyResolvedColorMode,
  isStoredColorMode,
  persistColorModeCookie,
  type StoredColorMode,
} from "@/lib/color-mode";

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readPreference(): StoredColorMode {
  const fromDom = document.documentElement.getAttribute("data-color-mode");
  if (isStoredColorMode(fromDom)) {
    return fromDom;
  }
  try {
    const stored = window.localStorage.getItem(COLOR_MODE_STORAGE_KEY);
    if (isStoredColorMode(stored)) {
      return stored;
    }
  } catch {
    // Storage can be refused; Auto still works from the system preference.
  }
  return "auto";
}

function applyPreference(mode: StoredColorMode): void {
  const isDark =
    mode === "dark" ||
    (mode !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  applyResolvedColorMode(document.documentElement, mode, isDark);
  try {
    window.localStorage.setItem(COLOR_MODE_STORAGE_KEY, mode);
  } catch {
    // A blocked store still applies for this page.
  }
  document.cookie = persistColorModeCookie(
    mode,
    window.location.hostname,
    window.location.protocol,
  );
  emit();
}

export function ColorModePicker({ className = "" }: { className?: string }) {
  const value = useSyncExternalStore(subscribe, readPreference, () => "auto" as const);

  return (
    <fieldset
      className={`m-0 inline-flex rounded-full border border-border bg-card p-0.5 text-xs font-medium text-muted-foreground ${className}`}
    >
      <legend className="sr-only">Colour</legend>
      {COLOR_MODES.map((mode) => {
        const selected = value === mode;
        const label = mode === "auto" ? "Auto" : mode === "light" ? "Light" : "Dark";
        return (
          <label
            key={mode}
            className={`cursor-pointer rounded-full px-2.5 py-1 transition-colors ${
              selected ? "bg-muted text-foreground" : "hover:text-foreground"
            }`}
          >
            <input
              type="radio"
              name="color-mode"
              value={mode}
              checked={selected}
              className="sr-only"
              onChange={() => {
                applyPreference(mode);
              }}
            />
            {label}
          </label>
        );
      })}
    </fieldset>
  );
}
