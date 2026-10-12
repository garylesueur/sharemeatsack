import { CURSOR_PLUGIN_HREF } from "./cursor-install";
import { publicOrigin } from "./public-origin";

export function siteChromeProps() {
  const origin = publicOrigin();
  return {
    product: "share" as const,
    repoHref: CURSOR_PLUGIN_HREF,
    docs: [
      { label: "Install plugin", href: "/install" },
      { label: "skill.md", href: `${origin}/skill.md` },
      { label: "mcp.md", href: `${origin}/mcp.md` },
      { label: "llms.txt", href: "/llms.txt" },
    ],
  };
}
