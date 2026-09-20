import type { ReactNode } from "react";
import { ColorModePicker } from "@/components/color-mode-picker";

export function SiteAppearance({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-background text-foreground">
      <div className="flex w-full justify-end px-6 pt-3 sm:px-8">
        <ColorModePicker />
      </div>
      {children}
    </div>
  );
}
