import type { ReactNode } from "react";
import { SiteAppearance } from "@/components/site-appearance";
import { SiteShell } from "@/components/site-chrome";
import { siteChromeProps } from "@/lib/site-chrome";

/** Working transfer pages: wordmark and tokens, no hero. */
export function TransferShell({ children }: { children: ReactNode }) {
  return (
    <SiteAppearance>
      <SiteShell {...siteChromeProps()}>
        <div className="mx-auto w-full max-w-xl pt-10 pb-4">{children}</div>
      </SiteShell>
    </SiteAppearance>
  );
}

/** Unknown, expired, and cancelled stay unadorned. */
export function PlainTransfer({ children }: { children: ReactNode }) {
  return <main className="mx-auto max-w-xl px-6 py-16">{children}</main>;
}
