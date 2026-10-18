import { CURSOR_PLUGIN_HREF } from "./cursor-install";
import { PRODUCT_NAME } from "./product";
import { publicOrigin } from "./public-origin";

export const SIBLING = {
  name: "ask.imeatsack.com",
  href: "https://ask.imeatsack.com",
} as const;

export function siteChromeProps() {
  const origin = publicOrigin();
  return {
    wordmark: PRODUCT_NAME,
    sibling: SIBLING,
    repoHref: CURSOR_PLUGIN_HREF,
    accountHref: "https://meatsack.puregaz.com/sign-in?product=sharemeatsack",
    docs: [
      { label: "Install plugin", href: "/install" },
      { label: "skill.md", href: `${origin}/skill.md` },
      { label: "mcp.md", href: `${origin}/mcp.md` },
      { label: "llms.txt", href: "/llms.txt" },
    ],
  };
}
