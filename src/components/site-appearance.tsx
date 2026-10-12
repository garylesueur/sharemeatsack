import type { ReactNode } from "react";

export function SiteAppearance({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-background text-foreground">{children}</div>
  );
}
