---
id: site-discoverability
area: Site / Discoverability
status: implemented
---

# Site discoverability

Public pages tell search engines, answer engines, and agents what sharemeatsack.com is. Transfer links stay private.

## Behaviours

### B1 — Home carries ordinary share metadata 🟢 implemented

The home page has a title, description, canonical URL, and Open Graph tags naming sharemeatsack.com.

Browser tabs and phone home-screen bookmarks use the product’s Meatsack
character icon and its ask, show, or share badge. `public/plugin-icon.png` owns
the artwork; `pnpm sync:icons` exports the multi-size favicon, 32px PNG icon,
and 180px Apple touch icon. Builds regenerate these exports and tests check
that they match the source. Next.js supplies their metadata links.

### B2 — Crawlers get a sitemap and robots file 🟢 implemented

Crawlers can fetch a sitemap of the public documents (home, MCP page, markdown guide, skill, llms.txt). Robots allow those, and do not ask crawlers to index API routes or transfer pages.

### B3 — Answer engines get a plain-text index 🟢 implemented

`/llms.txt` describes the product in short and lists the skill, the MCP/HTTP guide, and the Cursor plugin.

### B4 — Pasting the MCP URL yields a guide 🟢 implemented

Opening `https://sharemeatsack.com/mcp` in a browser shows a short HTML page with the MCP URL and links to the markdown guide, skill, and Cursor plugin. Fetching that same URL as markdown, or fetching `/mcp.md`, returns a markdown API guide.

### B5 — The skill is on the site 🟢 implemented

`/skill.md` is the sharemeatsack.com skill and matches the skill shipped for Cursor.

### B6 — Transfer pages are not for search 🟢 implemented

An upload or download URL tells crawlers not to index it. The sitemap does not list transfers.

### B7 — The repository is an Agent Plugin 🟢 implemented

The repository root is an Agent Plugin. `.cursor-plugin/plugin.json` is present so Cursor can add this clone as an Open Plugin.

### B8 — Plugins share a Meatsack marketplace 🟢 implemented

The Meatsack marketplace lists askmeatsack.com, showmeatsack.com, and
sharemeatsack.com as independently installable plugins. This product's plugin
ID is `sharemeatsack`; its listing name and tool name remain **sharemeatsack.com**.
The product repository owns its manifest, skill, hosted MCP configuration, and
logo. The marketplace sync copies a minimal package from those sources.

The portable manifest carries OpenAI listing metadata and logo paths. Claude
Code and Cursor compatibility manifests use the same plugin ID and version.
The homepage leads with an **Install plugin** action to `/install`. The guide
shows this product’s character icon, app-specific steps and copyable commands for
Codex, Claude Code, and Cursor. Add the marketplace once per app, then choose
one or more plugins. Direct MCP setup remains available as a secondary option.
The install guide is linked from the footer and sitemap;
`/llms.txt`, `/mcp.md`, and the HTML MCP guide link to the marketplace. Each
plugin includes both the MCP connection and the same skill served at `/skill.md`.

Publication of `garylesueur/meatsack-marketplace` must precede deployment of the
website links. Public ChatGPT/Codex and Cursor directory submissions are a
separate release step.

## Rules (Invariants)

- Public documents never include a live agent token or a live transfer secret.
- Transfer URLs are not in the sitemap.

## Decision Tables

_None._

## User Flows

_None._

## Open Questions

_None._

## Future Considerations

_None._

## Out of Scope

- Indexing someone else’s transfer.
