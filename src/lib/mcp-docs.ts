import { MARKETPLACE_HREF, pluginInstallMarkdown } from "./plugin-install";
import { CURSOR_PLUGIN_HREF, cursorInstallPageHref } from "./cursor-install";
import { SHAREMEATSACK_SKILL_MARKDOWN } from "./sharemeatsack-skill";
import { PRODUCT_NAME, PRODUCT_SENTENCE } from "./product";
import { publicOrigin } from "./public-origin";

export const SITE_TITLE = PRODUCT_NAME;
export const SITE_TAGLINE = PRODUCT_SENTENCE;
export const SITE_DESCRIPTION =
  "Create a request or a send, paste the link, wait. The person never signs in. Bytes go straight to storage.";

export function llmsTxt(origin = publicOrigin()): string {
  return `# ${PRODUCT_NAME}

> ${SITE_TAGLINE} ${SITE_DESCRIPTION}

${PRODUCT_NAME} is how an agent shares files with a person, or gets files from a person. Create returns a human link and a private manage link. The agent delivers the link. MCP and HTTP are the same transfer.

## Docs

- [Skill](${origin}/skill.md): How to use the ${PRODUCT_NAME} tool
- [MCP and HTTP](${origin}/mcp.md): Connect, actions, curl
- [Plugin marketplace](${MARKETPLACE_HREF}): Install in Codex, Claude Code, or Cursor
- [Plugin source](${CURSOR_PLUGIN_HREF}): MCP plus the skill
- [Home](${origin}/): Human landing page

## Optional

- [llms.txt](${origin}/llms.txt)
`;
}

export function mcpGuideMarkdown(origin = publicOrigin()): string {
  const mcpUrl = `${origin}/mcp`;
  const createUrl = `${origin}/api/v1/transfers`;
  const cursorHref = cursorInstallPageHref(mcpUrl);
  return `# ${PRODUCT_NAME}

${SITE_TAGLINE} ${SITE_DESCRIPTION}

This URL is the MCP server. Browsers get a short page. Agents should fetch \`${origin}/mcp.md\` or send \`Accept: text/markdown\`. The Cursor skill is \`${origin}/skill.md\`.

## Connect

- MCP (Streamable HTTP): \`${mcpUrl}\`
- Skill: [${origin}/skill.md](${origin}/skill.md)
- This guide: [${origin}/mcp.md](${origin}/mcp.md)
- HTTP create: \`POST ${createUrl}\`
- Cursor install: ${cursorHref}
- Cursor plugin: [${CURSOR_PLUGIN_HREF}](${CURSOR_PLUGIN_HREF}) — MCP plus the skill
- Grok: [grok.com/connectors](https://grok.com/connectors) — Custom, paste the MCP URL. There is no one-click badge yet.

There is no API key. Create is open today. Creating will later need a lanyard account. The person who opens the link never signs in.

${pluginInstallMarkdown()}
## Tool

The tool is named \`${PRODUCT_NAME}\`. Actions: \`request\`, \`send\`, \`status\`, \`wait\`, \`cancel\`, \`files\`.

POST JSON-RPC to \`${mcpUrl}\`. Do not invent extra tools, a Slack bot, or a mailer of your own.

## Skill

${SHAREMEATSACK_SKILL_MARKDOWN.trim()}

## HTTP

Same transfer as the tool.

\`\`\`
POST ${createUrl}
Content-Type: application/json

{
  "action": "request",
  "title": "Invoices"
}
\`\`\`

Create a request and you get \`uploadUrl\`, \`pollUrl\`, and \`manageUrl\`. Create a send with \`files: [{ name, type, size }]\` and you get one upload URL per file plus \`downloadUrl\`. Keep the token on \`pollUrl\` and \`manageUrl\`. Paste the human link where they will see it.

- Status: \`GET /api/v1/transfers/{transferId}?token=\`
- Wait: \`POST /api/v1/transfers/{transferId}/wait\` (bound at most 60 seconds; one call sits up to 50, then answers \`timedOut: true\` with \`nextAction: "wait"\` — call it again)
- Cancel: \`POST /api/v1/transfers/{transferId}/cancel\`
- Files: \`GET /api/v1/transfers/{transferId}/files?token=\`
- Manage summary: \`GET /s/{transferId}/manage?token=\` (markdown at \`.md\`)

## Do not

- Index or share transfer pages (\`/s/…\`). Those are private links.
- Put the agent status secret or manageUrl on the human page.
- Treat Slack or email posting as a feature of this product.
- Put file bytes in the tool argument or expect them in the tool result.
`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function mcpGuideHtml(origin = publicOrigin()): string {
  const mcpUrl = `${origin}/mcp`;
  const title = escapeHtml(SITE_TITLE);
  const tagline = escapeHtml(SITE_TAGLINE);
  const description = escapeHtml(SITE_DESCRIPTION);
  const mcpEscaped = escapeHtml(mcpUrl);
  const originEscaped = escapeHtml(origin);
  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} MCP</title>
  <meta name="description" content="${tagline} ${description}">
  <link rel="canonical" href="${mcpEscaped}">
  <link rel="alternate" type="text/markdown" href="${originEscaped}/mcp.md">
  <link rel="alternate" type="text/plain" href="${originEscaped}/llms.txt">
  <style>
    body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; background: #fafafa; color: #18181b; line-height: 1.6; }
    main { max-width: 36rem; margin: 0 auto; padding: 4rem 1.5rem; }
    p.brand { color: #71717a; font-size: 0.875rem; }
    h1 { font-size: 1.75rem; font-weight: 600; letter-spacing: -0.02em; }
    a { color: #18181b; }
    code { font-family: ui-monospace, monospace; font-size: 0.875rem; background: #fff; padding: 0.15rem 0.4rem; border-radius: 0.4rem; }
    ul { padding-left: 1.2rem; }
    .muted { color: #71717a; }
  </style>
</head>
<body>
  <main>
    <p class="brand">${title}</p>
    <h1>${tagline}</h1>
    <p>${description}</p>
    <p>MCP: <code>${mcpEscaped}</code></p>
    <p>POST here for the protocol. For a guide, fetch markdown.</p>
    <ul>
      <li><a href="${originEscaped}/mcp.md">API guide (markdown)</a></li>
      <li><a href="${originEscaped}/skill.md">Skill</a></li>
      <li><a href="${CURSOR_PLUGIN_HREF}">Cursor plugin</a></li>
      <li><a href="${MARKETPLACE_HREF}">Meatsack plugin marketplace</a></li>
      <li><a href="${originEscaped}/llms.txt">llms.txt</a></li>
      <li><a href="${originEscaped}/">${title}</a></li>
    </ul>
    <p class="muted">One tool, named ${title}. Request or send, paste the link, wait.</p>
  </main>
</body>
</html>
`;
}

export function mcpGetDocumentKind(request: Request): "html" | "markdown" | "mcp" {
  const accept = request.headers.get("accept") ?? "";
  const protocol = request.headers.get("mcp-protocol-version");
  if (protocol) {
    return "mcp";
  }
  if (accept.includes("text/event-stream")) {
    return "mcp";
  }
  if (accept.includes("text/markdown") || accept.includes("text/plain")) {
    return "markdown";
  }
  if (accept.includes("application/json") && !accept.includes("text/html")) {
    return "mcp";
  }
  return "html";
}

export function htmlDocumentResponse(html: string, origin = publicOrigin()): Response {
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      Link: `<${origin}/mcp.md>; rel="alternate"; type="text/markdown"`,
    },
  });
}

export function markdownResponse(markdown: string): Response {
  return new Response(markdown, {
    headers: { "content-type": "text/markdown; charset=utf-8" },
  });
}

export function plainTextResponse(body: string): Response {
  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
