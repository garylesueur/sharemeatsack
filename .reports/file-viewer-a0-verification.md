# File viewer A0 — verification

Date: 6 October 2026. Scope: documentation and flow contracts only.

## Delivered

- `specs/transfers/files/viewing-files.md`: 19 future behaviours, count/type/access/budget decision tables, invariants and future/out-of-scope boundaries.
- `specs/transfers/files/viewing-files.flow.yaml`: two authoritative flows. F1 resolves the link and listed-file surface; F2 covers browsing, selected-file loading, renderer use, retry/renewal, leaving, lost access and changed file lists.
- `specs/transfers/files/viewing-files.flow.mmd`: generated diagram, never hand-edited.
- Transfer index link and scoped clarification in `moving-files.md`: its public expiry table no longer contradicts the existing private retained-file contract in `requesting.md`. No behaviour badges or application permissions were changed.
- Implementation plan: A0 completion evidence, B1 next-up marker, and B1–D2 references to the new behaviour IDs.

## Acceptance review

| Required journey | Contract path |
| --- | --- |
| One image | F1.T4 → F2.T1/T5/T7; image controls B10, limits B18; no collection controls B2 |
| Video collection | F1.T5 → F2.T2/T4/T5/T7; B12 controls and F2.T22 stop previous playback; F2.T26 returns to the collection |
| Mixed batch | B3/B4 List default and type filters; F2.T3 preserves browsing context, F2.T4 selects the appropriate viewer |
| Blocked private file | F1 permits its listing; F2.T6 produces a blocked card without read/download actions under B6/B8 |
| Expired public link | F1.T6 refuses new public access; F2.T29–T33 stop loading/playback on detected access loss; renewal denial uses F2.T13 |
| Expired retained private file | B8 and the access table preserve existing agent rules while an accepted eligible object remains retained |
| Failed preview | F2.T9/T17 → fallback; F2.T15 explicit Retry; F2.T20 retains permitted original download |
| Changed selection/list | F2.T21–T28 cancel prior work and preserve collection context; F2.T39–T44 restore a surviving selection or current empty/status outcome |

All active design families have a numbered requirement: images B10/B11, video B12, audio B13, Markdown B14, text/code/HTML source B15, PDF B16, CSV/TSV B17. Office/archive/specialist fallbacks use B7; richer rendering remains deferred. Accessibility B19 and limits B18 apply across the viewers.

## Structured validation

Parsed YAML using the installed `yaml` parser from the existing Cleanroom checkout. Checked:

- Front matter and required spec section order; 19 unique sequential future behaviour IDs.
- Two unique flow IDs, 18 unique reachable states, 52 unique transition IDs.
- Declared start/from/to states, valid state kinds, outgoing transitions for every non-terminal state, terminal outcomes and no terminal outgoing transitions.
- Every transition cites real behaviour IDs; the union covers B1–B19.
- Multi-branch events contain at most one unguarded fallback, after guarded branches. Product-language guards were also manually reviewed for mutual exclusivity.
- Generated diagram contains every contracted state and transition, with matching namespaced IDs and the required generated-file header.
- Local Markdown links resolve; scoped tracked diff passes `git diff --check`.

`pnpm exec oxfmt --check` passed for the supported YAML file. Its output matched one file; it does not certify Markdown formatting. Markdown was inspected directly. No application tests or build were run because this chunk changes no application code, dependencies or runtime behaviour.

## Diagram generation evidence and ownership

The installed Calm Craft plugin supplies the flow format/template, but no local renderer was present in sharemeatsack. An existing owning renderer was found at `/private/tmp/cleanroom-verified-fixes/scripts/render-flow.mjs`.

For this generation, a temporary adapter at `/private/tmp/sharemeatsack-render-viewing-flow.mjs` changes only its input path to a command-line argument and points its YAML import at Cleanroom's installed parser. From the sharemeatsack root, it was run as:

```sh
node /private/tmp/sharemeatsack-render-viewing-flow.mjs specs/transfers/files/viewing-files.flow.yaml
```

The adapter follows the existing renderer's state/transition generation and writes the Mermaid companion from YAML. No diagram output was edited manually and no temporary tool or dependency was added to the application repository. The temporary checkout/adapter is not a portable project dependency: before regenerating in another environment, use the owning renderer or arrange portable rendering through the Calm Craft plugin. Do not hand-edit the diagram to work around absent tooling.

## Remaining decisions

Renderer/library and supported-browser decisions belong to B3 and the relevant C/D chunks. The spec records their blocking behaviour IDs. First-release limits, Markdown attachment/remote-asset policy, both viewing surfaces and public/private access rules are settled for implementation.

Application source, deployment and the user's supplied video were untouched. Existing unrelated checkout changes were preserved.
