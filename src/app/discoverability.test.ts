import { describe, expect, it } from "vitest";
import { PRODUCT_ORIGIN } from "@/lib/product";
import robots from "./robots";
import sitemap from "./sitemap";

import { GET as markdownHome } from "./index.md/route";
import { GET as fullDocumentation } from "./llms-full.txt/route";
import { mcpGuideMarkdown, siteJsonLd } from "@/lib/mcp-docs";

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
  it("serves canonical text equivalents with the current guide and family identity", async () => {
    const home = markdownHome();
    const full = fullDocumentation();
    expect(home.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
    expect(full.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    for (const response of [home, full]) {
      expect(response.headers.get("X-Robots-Tag")).toBe("noindex, follow");
      expect(response.headers.get("Link")).toContain(
        '<https://share.imeatsack.com/>; rel="canonical"',
      );
    }
    const overview = await home.text();
    expect(overview).toContain("https://imeatsack.com");
    expect(overview).toContain("https://share.imeatsack.com/install");
    expect(await full.text()).toContain(mcpGuideMarkdown());
    const schema = siteJsonLd()["@graph"];
    expect(schema).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          "@type": "SoftwareApplication",
          applicationSuite: "I, Meatsack",
        }),
        expect.objectContaining({
          "@type": "WebSite",
          isPartOf: expect.objectContaining({ "@id": "https://imeatsack.com/#website" }),
        }),
      ]),
    );
  });
});
