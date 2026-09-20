import { describe, expect, it } from "vitest";
import { llmsTxt, mcpGuideHtml, mcpGuideMarkdown, mcpGetDocumentKind } from "./mcp-docs";
import { PRODUCT_NAME, PRODUCT_ORIGIN, PRODUCT_SENTENCE } from "./product";

describe("agent docs", () => {
  it("llms.txt and the MCP guide point at the skill and the markdown URL", () => {
    const index = llmsTxt(PRODUCT_ORIGIN);
    expect(index).toContain(PRODUCT_SENTENCE);
    expect(index).toContain(`${PRODUCT_ORIGIN}/skill.md`);
    expect(index).toContain(`${PRODUCT_ORIGIN}/mcp.md`);
    const guide = mcpGuideMarkdown(PRODUCT_ORIGIN);
    expect(guide).toContain('action": "request"');
    expect(guide).toContain("`send`");
    expect(guide).toContain(`${PRODUCT_ORIGIN}/skill.md`);
  });

  it("browser HTML for /mcp links the guide, skill, and plugin", () => {
    const html = mcpGuideHtml(PRODUCT_ORIGIN);
    expect(html).toContain(PRODUCT_NAME);
    expect(html).toContain(`href="${PRODUCT_ORIGIN}/mcp.md"`);
    expect(html).toContain(`href="${PRODUCT_ORIGIN}/skill.md"`);
    expect(html).toContain(`href="${PRODUCT_ORIGIN}/llms.txt"`);
  });

  it("treats a browser Accept as HTML and markdown Accept as the guide", () => {
    expect(
      mcpGetDocumentKind(
        new Request("https://sharemeatsack.com/mcp", { headers: { accept: "text/html" } }),
      ),
    ).toBe("html");
    expect(
      mcpGetDocumentKind(
        new Request("https://sharemeatsack.com/mcp", { headers: { accept: "text/markdown" } }),
      ),
    ).toBe("markdown");
    expect(
      mcpGetDocumentKind(
        new Request("https://sharemeatsack.com/mcp", {
          headers: { "mcp-protocol-version": "2025-03-26" },
        }),
      ),
    ).toBe("mcp");
  });
});
