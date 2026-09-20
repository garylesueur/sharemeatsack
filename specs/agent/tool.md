---
id: agent-tool
area: Agent / Tool
status: partial
---

# The sharemeatsack.com tool

An agent moves files by calling one tool named **sharemeatsack.com**, or the same actions over HTTP. There is no API key today. Creating will later need a lanyard account. The person on the other end of the link never signs in.

## Behaviours

### B1 — One tool, several actions 🟢 implemented

The tool is named `sharemeatsack.com`. Its actions are `request`, `send`, `status`, `wait`, `cancel`, and `files`. There are no extra tool names. HTTP under `/api/v1/transfers` is the same product: the same payload in, the same links and status out.

### B2 — Create is open today 🟢 implemented

Calling `request` or `send` needs no key. A flood from one address is refused for a while. Creating will later need a lanyard token; a call without one will be told where to authorise. The person who opens an upload or download link still needs nothing.

### B3 — The agent confirms the person when someone will open the link 🟢 implemented

The skill tells the agent to name the person and confirm it knows how to reach them — Slack, mail, this chat — before it creates a *request*, or before it *hands a send to someone*. “Put these on meatsack” does not need a recipient. This product does not store contacts and does not look anyone up. A guessed address is not a reason to fire a request.

### B4 — The agent delivers the link 🟢 implemented

Create returns the human link immediately. Putting it in this conversation, Slack, mail, or anywhere else the agent can already post is the agent’s job. This service does not send mail and does not post to other chats. The skill says so.

### B5 — The agent waits or is called back 🟡 partial
> `wait` and `status` are live. A callback URL is recorded and marked attempted; HTTP delivery is still outstanding.

After create, the agent keeps the transfer id and the agent token. `wait` sits for up to a stated number of seconds and is safe to call again. `status` is the same result without holding the line. A `callbackUrl` on create is notified once on a terminal status.

### B6 — The agent gets URLs, not bytes 🟢 implemented

`status`, `wait`, and `files` return names, sizes, types, scan status, and short-lived download URLs. They never return file bytes. The skill tells the agent not to pull a large file into the conversation: paste the URL, or write a small file where the client can.

### B7 — Send offers upload URLs, not a body 🟢 implemented

`send` takes each file as a name, type, and size. The reply includes one upload URL per file. The agent puts the bytes at those URLs. A refresh of an upload URL is part of the same send, not a new transfer.

### B8 — A skill ships with the product 🟢 implemented

`skills/sharemeatsack/SKILL.md` is the source of truth for agent behaviour. The MCP server sends that text as its instructions. `/skill.md` serves the same text. Generated copies used by the site and by Cursor are produced from that file and are not edited by hand.

### B9 — The repository is an Agent Plugin 🟢 implemented

The repository root is an Agent Plugin: `plugin.json`, `mcp.json`, and `skills/`. A client that understands Agent Plugins can install it and get the hosted sharemeatsack.com MCP server plus the skill. `.cursor-plugin/plugin.json` lets Cursor add the clone as an Open Plugin from this folder.

### B10 — GET /mcp is docs for a browser, protocol for a client 🟢 implemented

Opening `/mcp` in a browser shows a short guide. A client speaking MCP uses the same URL as Streamable HTTP. `/mcp.md`, `/skill.md`, and `/llms.txt` are the machine-readable set.

## Rules (Invariants)

- There is one tool name: `sharemeatsack.com`.
- Tool and HTTP are the same transfers.
- The agent token is a bearer secret. It does not appear in the human URL.
- This service does not send mail and does not post to other chats.
- File bytes are never a tool argument or a tool result.
- The skill is the only place agent behaviour is authored.

## Decision Tables

### Which action to call

| The agent needs to | Action |
| --- | --- |
| Ask a person for files | `request` |
| Give a person files | `send` |
| See whether it is done | `status` or `wait` |
| Stop it | `cancel` |
| Get fresh download URLs | `files` |

## User Flows

_None._ Request and send own the journeys.

## Open Questions

- **Settled:** No inbound-only FileSnare MCP. The agent reading files back (as URLs) is the product.
- **Settled:** No product-side mailer to cover an agent that cannot reach the person.
- **Settled:** Confirm-then-create is skill behaviour, not a contacts feature.

## Future Considerations

- Lanyard on create (free account; teams and custom domains paid).
- A Meatsack portal that lists transfers after sign-in.
- OAuth connect for hosted agents, once lanyard is the door.

## Out of Scope

- A toolbox of many named tools.
- API keys and workspace scopes in the FileSnare style.
- Treating Slack or email posting as a feature of this product.
- Letting the agent invent a second file host, a gist, or an email attachment instead of this tool.
