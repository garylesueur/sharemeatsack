# share.imeatsack.com

**An agent shares files with a person, or gets files from a person.**

An agent creates a request or a send and gets a link. A person opens that
link in a browser and uploads or downloads. They never sign in. There is no
API key. Create is open today.

Posting the link to Slack, email, or anywhere else is the calling agent's job.

Sibling projects: [ask.imeatsack.com](https://github.com/garylesueur/askmeatsack) —
an agent asks, a person answers. [show.imeatsack.com](https://github.com/garylesueur/showmeatsack) —
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

Three 1Password items live in the **Agents** vault: `y4tyhoe2snpl2eki4baltvlmwi`, `otnqsmx6g7jpkrq2ttqlj7m4fu`, and `wsx7fzegvrckenlgc4ov7zt25m`.
Same field names, different values. Local work uses Development only.

`.env.development.tpl`, `.env.preview.tpl`, and `.env.production.tpl` hold
`op://` references for secrets and plain values for non-secrets
(`PUBLIC_BASE_URL`, `LANYARD_URL`). `.env.example` is the empty placeholder.
Never print `.env` contents and never commit secrets.

## Sign-in (lanyard)

People sign in on lanyard, never here. `LANYARD_URL` is lanyard's origin and is
not a secret. It is empty in every template, which keeps this service exactly as
it is without lanyard: no **Sign in** link, and any `Authorization` header on
create is ignored.

Set it (for example in `.env.local`, or with `vercel env add LANYARD_URL`, or by
filling the template line and running `pnpm env:vercel`) to switch sign-in on:

- The header shows **Sign in**, linking to `{LANYARD_URL}/sign-in?product=sharemeatsack`.
- An agent may send a lanyard token as `Authorization: Bearer …` on
  `POST /api/v1/transfers` or on an MCP `request`/`send`. It is verified with
  `POST {LANYARD_URL}/api/v1/verify`. Accepted: the new transfer records the
  account. Refused: `401 unauthorized`, nothing created. If lanyard is down, a
  token accepted in the last five minutes still works.
- Creates without a token, and every route that takes a transfer token as
  Bearer, never contact lanyard.

`src/lib/product-verifier.ts` is a verbatim copy of lanyard's
`src/lib/verification/product-verifier.ts`. Change it there and copy it back.
Pages read `LANYARD_URL` at build time, so redeploy after changing it.

## Plugin marketplace

The plugin ID is `sharemeatsack`; its display name and MCP tool name are
**share.imeatsack.com**. The portable manifest includes OpenAI listing metadata and
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

Then install **share.imeatsack.com** from the Meatsack source in Plugins.

Claude Code:

```text
/plugin marketplace add garylesueur/meatsack-marketplace
/plugin install sharemeatsack@meatsack
```

Cursor Teams/Enterprise: Dashboard → Plugins & MCPs → Add Marketplace →
Import from Repo, using the marketplace repository URL. Install the product
from Customize. For a personal account, copy the plugin package into `~/.cursor/plugins/local/`.
See the [installation guide](https://share.imeatsack.com/install) for commands.

Marketplace publication must precede deploying these website install links.
Public ChatGPT/Codex and Cursor directory listings require separate submissions.

### Site icons

The browser favicon and Apple touch icon use the same character artwork as the
plugin listing. Edit `public/plugin-icon.png`, then run `pnpm sync:icons` to
regenerate `src/app/favicon.ico`, `src/app/icon.png`, and
`src/app/apple-icon.png`. Do not edit those exports by hand. Builds regenerate
them, and tests check that they match the source.
