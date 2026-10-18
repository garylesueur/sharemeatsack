"use client";
import { useEffect, type RefObject } from "react";
import { createOverlayOwnership } from "@/lib/overlay-ownership";

type Owner = ReturnType<typeof createOverlayOwnership<HTMLElement>>;
const shared = globalThis as typeof globalThis & {
  sharemeatsackOverlayOwners?: WeakMap<object, Owner>;
};
function pageOwner() {
  const owners = (shared.sharemeatsackOverlayOwners ??= new WeakMap<object, Owner>());
  let owner = owners.get(document.body.style);
  if (!owner) {
    owner = createOverlayOwnership<HTMLElement>(document.body.style);
    owners.set(document.body.style, owner);
  }
  return owner;
}

// Fixed viewers hide the underlying page visually. Keep its links out of the
// keyboard/accessibility tree too, restoring their original state on exit.
export function useOverlaySurface(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
  query?: string,
) {
  useEffect(() => {
    if (!enabled) return;
    const candidate = ref.current;
    if (!candidate) return;
    const element: HTMLElement = candidate;
    const media = query ? window.matchMedia(query) : null;
    let restore: (() => void) | undefined;
    function apply() {
      restore?.();
      restore = undefined;
      if (media && !media.matches) return;
      const active = document.activeElement;
      const siblings: HTMLElement[] = [];
      let child: HTMLElement | null = element;
      while (child?.parentElement && child !== document.body) {
        for (const sibling of child.parentElement.children) {
          if (
            sibling !== child &&
            sibling instanceof HTMLElement &&
            !["SCRIPT", "STYLE"].includes(sibling.tagName)
          ) {
            siblings.push(sibling);
          }
        }
        child = child.parentElement;
      }
      const release = pageOwner().hold(siblings);
      const role = element.getAttribute("role"),
        modal = element.getAttribute("aria-modal");
      element.setAttribute("role", "dialog");
      element.setAttribute("aria-modal", "true");
      element.focus({ preventScroll: true });
      restore = () => {
        release();
        if (role === null) element.removeAttribute("role");
        else element.setAttribute("role", role);
        if (modal === null) element.removeAttribute("aria-modal");
        else element.setAttribute("aria-modal", modal);
        if (active instanceof HTMLElement && active.isConnected && !active.inert)
          active.focus({ preventScroll: true });
      };
    }
    apply();
    media?.addEventListener("change", apply);
    return () => {
      media?.removeEventListener("change", apply);
      restore?.();
    };
  }, [ref, enabled, query]);
}
