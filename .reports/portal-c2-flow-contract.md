# C2 Share incoming contract checkpoint

Authored on 2026-10-11 before C2 runtime implementation. This checkpoint records
contract work only; it does not establish browser, API, deployed or storage acceptance.

## Scope and changes

- Expanded `specs/transfers/accounts/workspace.md` B4 to partial for prioritised C2,
  with a specific missing-acceptance note. The workspace roll-up remains partial.
- Appended F4 to `specs/transfers/accounts/workspace.flow.yaml`: 22 states and
  91 stable transitions. F1–F3 and all their IDs/text remain unchanged.
- Save stores one account-private incoming reference without file bytes, ownership
  changes, permanent source retention or recipient powers beyond the original link.
- The fixed portal landing uses `/save/sharemeatsack#url=<encoded-canonical-public-URL>`,
  strips the fragment immediately and retains one tab's intent in sessionStorage
  for 15 minutes. Authentication uses the existing Share Incoming destination only.
  Token-bearing URLs do not enter authentication/redirect queries, cookies or activity.
- Incoming confirms the current account and recipient role and waits for explicit Save.
  Blocked storage, missing/expired intent, source loss during sign-in, account changes,
  cancellation and uncertain-save retries all have recovery paths.
- Sends permit eligible current recipient reads; requests grant only their upload role,
  without receipt browsing or access to another person's uploaded files.
- Keeping uses the existing independent-copy and cleanup lifecycle with decimal 1 GB
  allowance, current source/scan/retention/file-identity checks at commit, idempotent
  retries and no available copy after pre-commit source loss or cancellation. Committed
  independent copies survive the original source ending under their own My files policy.
- C2 keeps files only from newer account-backed durable sources that support authoritative
  commit-time checks. Existing legacy links remain saveable/openable under their current
  rules; keeping explains `legacy_source`. Migration, cleanup of existing records/fixtures,
  activity UI, historical claims and additional recipient powers are outside scope.

## Verification

The owning parser in `/private/tmp/meatsack-c1-flow-tool/src/specs/flow-contract.ts`
accepts the complete contract. It verifies unique IDs, declared and reachable states,
valid transitions, outgoing paths and terminal outcomes. An additional check confirms
transition numbering, real B1–B8 references, at most one fallback per event group,
and both byte-for-byte and parsed semantic preservation of F1–F3. A manual branch
review covers mutually exclusive account/access, quota, cancellation and already-committed
copy outcomes, including hidden or removed copies and source loss after commit.

The scoped `pnpm exec oxfmt --check` passes for the YAML, which also passes the
owning parser. The repository formatter explicitly excludes `**/*.md`; the Markdown
was inspected against the spec format manually. No application tests were added or run for this documentation-only
subtask. Runtime, keyboard/narrow-layout, genuine account-isolation and durable-source
copy acceptance remain the main C2 implementation checkpoint's responsibility.

The parent agent owns Mermaid regeneration using the existing flow tool before runtime
implementation. This subtask did not hand-edit generated Mermaid or other generated files.
No UI/backend/schema/credential/network changes, commits, pushes or branches were made.
Pre-existing working-tree changes were preserved. Diagnostic scratch files were kept
outside the repository and removed after verification.
