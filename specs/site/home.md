---
id: site-home
area: Site / Home
status: implemented
---

# The home page

What a person sees when they arrive at sharemeatsack.com without knowing what it is. Its job is to explain the product, prove it, and get an agent connected.

## Behaviours

### B1 — The page says what this is before anything else 🟢 implemented

The first thing on the page is a plain sentence: an agent shares files with a person, or gets files from a person. Install instructions come after the explanation, not instead of it.

### B2 — A person can see both directions 🟢 implemented

The page shows the two jobs — “get files from Simon” and “put files on meatsack / send them to Simon” (the same send) — so someone who reads nothing else can tell what the product does.

### B3 — Connecting an agent takes one click where the client allows it 🟢 implemented

A person can add the MCP server to their client without copying anything, wherever that client supports it. Where it does not, the MCP URL is one click to copy.

### B4 — Anyone can read how it works without signing in 🟢 implemented

The home page, the MCP guide, and the skill are public. Opening a transfer link still needs the unguessable URL; those pages are not listed here.

## Rules (Invariants)

- The product is always called **sharemeatsack.com** on this page.
- Transfer links are not listed on the home page and are not for search.

## Decision Tables

_None._

## User Flows

_None._

## Open Questions

- Brand themes matching askmeatsack.com. **Settled:** the home uses the shared meatsack-brand shell (wordmark, sibling pill, hero, seam, steps, use cases, curl) with the iron accent. Character hero art is still a labelled placeholder.

## Future Considerations

- A playground transfer that does not need an agent.

## Out of Scope

- A dashboard of the visitor’s transfers. That is a later Meatsack portal, after lanyard.
- FileSnare marketing, pricing tables, or a contacts demo.
