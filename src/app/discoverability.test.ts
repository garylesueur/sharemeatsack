import { describe, expect, it } from "vitest";
import { PRODUCT_ORIGIN } from "@/lib/product";
import robots from "./robots";
import sitemap from "./sitemap";

describe("public crawler files", () => {
  it("lists the public documents and keeps transfers off the sitemap", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toEqual([
      PRODUCT_ORIGIN,
      `${PRODUCT_ORIGIN}/install`,
      `${PRODUCT_ORIGIN}/mcp`,
      `${PRODUCT_ORIGIN}/mcp.md`,
      `${PRODUCT_ORIGIN}/skill.md`,
      `${PRODUCT_ORIGIN}/llms.txt`,
    ]);
    expect(urls.join(" ")).not.toContain("/s/");
    expect(urls.join(" ")).not.toContain("/api/");
  });

  it("allows the public site and disallows API, transfers, and agent rewrites", () => {
    const file = robots();
    expect(file.host).toBe(PRODUCT_ORIGIN);
    expect(file.sitemap).toBe(`${PRODUCT_ORIGIN}/sitemap.xml`);
    expect(file.rules).toEqual({
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/s/", "/agent/"],
    });
  });
});
