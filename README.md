# sharemeatsack.com

**An agent shares files with a person, or gets files from a person.**

An agent creates a request or a send and gets a link. A person opens that
link in a browser and uploads or downloads. They never sign in. There is no
API key. Create is open today.

Posting the link to Slack, email, or anywhere else is the calling agent's job.

Sibling projects: [askmeatsack.com](https://github.com/garylesueur/askmeatsack) —
an agent asks, a person answers. [showmeatsack.com](https://github.com/garylesueur/showmeatsack) —
an agent posts a page, a person opens it.

An agent creates a request or a send. A person opens the page and uploads or
downloads. The bytes go to storage, not through the model.

## Quick start

```bash
pnpm install
pnpm env      # writes .env.local from the 1Password Development item
pnpm dev
```

No 1Password access? `cp .env.example .env.local` gets you a working local
server. Leave Redis empty to stay on in-memory stores; file uploads will need R2.

## Commands

| Command | Does |
| --- | --- |
| `pnpm dev` | Dev server, reads `.env.local` |
| `pnpm dev:op` | Dev server with secrets in-process, nothing written to disk |
| `pnpm env` | Write `.env.local` from the Development item |
| `pnpm env:op-items` | Create the three 1Password items if missing |
| `pnpm env:vercel [preview\|production]` | Push template → Vercel (default: both) |
| `pnpm typecheck` | TypeScript |
| `pnpm lint` | oxlint, plus the import-layer check |
| `pnpm format` | oxfmt |
| `pnpm test` | Vitest |
| `pnpm build` | Production build |

`pnpm typecheck`, `pnpm format:check`, `pnpm lint`, `pnpm test` and `pnpm build`
are the merge gates — see `.engineering/config.yaml`.

## Secrets

Three 1Password items live in the **Agents** vault: `sharemeatsack.com
Development`, `sharemeatsack.com Preview`, and `sharemeatsack.com Production`.
Same field names, different values. Local work uses Development only.

`.env.development.tpl`, `.env.preview.tpl`, and `.env.production.tpl` hold
`op://` references only. `.env.example` is the empty placeholder. Never print
`.env` contents and never commit secrets.

## Plugin marketplace

The plugin ID is `sharemeatsack`; its display name and MCP tool name are
**sharemeatsack.com**. The portable manifest includes OpenAI listing metadata and
icons; `.claude-plugin/plugin.json` and `.cursor-plugin/plugin.json` provide
client compatibility.

The [Meatsack marketplace](https://github.com/garylesueur/meatsack-marketplace)
packages all three products. It contains generated, minimal plugin copies;
this repository remains the source for this product's manifest, skill, MCP
connection, and logo. Run the marketplace sync after changing those files.

Codex:

```sh
codex plugin marketplace add garylesueur/meatsack-marketplace
```

Then install **sharemeatsack.com** from the Meatsack source in Plugins.

Claude Code:

```text
/plugin marketplace add garylesueur/meatsack-marketplace
/plugin install sharemeatsack@meatsack
```

Cursor Teams/Enterprise: Dashboard → Plugins & MCPs → Add Marketplace →
Import from Repo, using the marketplace repository URL. Install the product
from Customize. A local clone can also be linked into `~/.cursor/plugins/local/`.

Marketplace publication must precede deploying these website install links.
Public ChatGPT/Codex and Cursor directory listings require separate submissions.
