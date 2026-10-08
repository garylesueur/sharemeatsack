# sharemeatsack.com — repository instructions

**Domain:** sharemeatsack.com

Greenfield project. An agent shares files with a person, or gets files from a person. Next.js App Router, TypeScript, Tailwind, pnpm — same shape as askmeatsack.com and showmeatsack.com. Merge gates live in `.engineering/config.yaml`.

## Commands

```bash
pnpm env         # Write .env.local from the Development item
pnpm dev         # Dev server (reads .env.local)
pnpm dev:op      # Dev server with Development secrets in-process, nothing on disk
pnpm env:op-items                     # Create the three 1Password items if missing
pnpm env:vercel [preview|production]  # Push tpl → Vercel (default: both)
pnpm typecheck   # TypeScript
pnpm lint        # oxlint plus the import-layer check
pnpm test        # Vitest
pnpm build       # Production build
```

1Password holds three items in the **Agents** vault (`mep374l3cpdtzwibf5fswsimbi`, override with `OP_VAULT`): `sharemeatsack.com Development`, `sharemeatsack.com Preview`, and `sharemeatsack.com Production`. Same field names, different values. Local commands use the Development item only. Leave Development Redis empty to stay local. File uploads will need R2. `.env.development.tpl`, `.env.preview.tpl`, and `.env.production.tpl` hold `op://` references only. `.env.example` is the empty placeholder. Never print `.env` contents, never commit secrets.

## What this is

An agent creates a request or a send, gets a link, and waits. The person opens the link and uploads or downloads. They never sign in. Posting that link to Slack, email, or anywhere else is the calling agent’s job. This service does not send mail.

Always call the product **sharemeatsack.com** in user-facing copy. The agent tool is named `sharemeatsack.com`. Human links will be `https://sharemeatsack.com/s/…`. Transfers themselves land from plan chunk A1.

## Where things live

- `.engineering/config.yaml` is the contract calm-craft skills read — paths, gates, tickets.
- Specs live in `specs/`. Format: `specs/README.md`. Start with `specs/transfers/requests/requesting.md`.
- The implementation plan is `.plans/v1.md`.
- Conventions live in `.engineering/conventions.yaml`.
- Calm Craft portable skills, references and assets come from the installed `calm-craft` tooling plugin. Invoke its `calm-craft:…` skills. Keep repository skills project-specific; repository settings live in `.engineering/config.yaml`.
- Shared brand files live in the `brand/` submodule ([meatsack-brand](https://github.com/garylesueur/meatsack-brand)).
- The repository root is an [Agent Plugin](https://agent-plugins.org/): `plugin.json`, `mcp.json`, and `skills/`. The skill text lands in A6.
- Implementation plans and review reports go in `.plans/` and `.reports/` (gitignored).

## Fixed decisions

- We are tooling. The agent knows the person, confirms, and delivers the link.
- Bytes never go through the tool, the chat, or this service’s compute.
- One batch seals a request. No zip-of-everything.
- Scan via cleanroom. Infected files are blocked. Files over 500 MiB are offered and flagged.
- Lanyard later. FileSnare’s dashboard does not come with us.

## Repository operations

- Do not commit, push, create a branch, or open a pull request unless explicitly asked.
- Preserve unrelated user changes in a dirty worktree.
- Prefer non-destructive and non-interactive commands.
