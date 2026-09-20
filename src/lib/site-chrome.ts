import { CURSOR_PLUGIN_HREF } from "./cursor-install";
import { PRODUCT_NAME } from "./product";
import { publicOrigin } from "./public-origin";

export const SIBLING = {
  name: "askmeatsack.com",
  href: "https://askmeatsack.com",
} as const;

export function siteChromeProps() {
  const origin = publicOrigin();
  return {
    wordmark: PRODUCT_NAME,
    sibling: SIBLING,
    repoHref: CURSOR_PLUGIN_HREF,
    docs: [
      { label: "skill.md", href: `${origin}/skill.md` },
      { label: "mcp.md", href: `${origin}/mcp.md` },
      { label: "llms.txt", href: "/llms.txt" },
    ],
  };
}
