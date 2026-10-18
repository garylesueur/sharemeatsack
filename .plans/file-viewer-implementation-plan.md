# sharemeatsack.com file viewer — implementation plan

**Created:** 6 October 2026  
**Status:** 🟢 complete — phases A–D verified locally on 2026-10-06. Production deployment remains separate.  
**Source design:** [File viewer UX proposal](./file-viewer-ux.md)  
**Spec guide:** [specs/README.md](../specs/README.md)  
**Strategy:** Specs first, then vertical slices that include the visible experience and its supporting access behaviour.  
**Delivery scope:** Phases A–D: 11 executable chunks. Rich Office, archive and specialist previews remain deferred.  
**Chunk size:** One focused agent session per chunk. No commit, push, deployment or PR is authorised by this plan alone.

## Outcome

A single shared file opens directly in an appropriate viewer. A collection has List and Grid views, with a selected-file viewer and previous/next navigation. The person can recognise, play, read and download files without navigating away from the transfer unnecessarily.

The same components serve public send pages and private manage pages, including files received through requests. This is the agreed implementation scope. The request upload link continues to show the upload flow and receipt under its existing permissions.

The design breaks down into these requirements:

- One file gets a direct viewer; multiple files get browsing controls and a viewer with collection navigation.
- Visual collections default to Grid; audio, documents and mixed collections default to List.
- Images use a gallery; video uses one player; audio uses one active track. Switching or closing stops playback.
- Markdown and source files get safe, bounded readers. PDF and CSV/TSV follow after the core media experience.
- Every type has a useful file card and Download original when access is permitted, even if preview fails.
- Filename, size, scan state and actions are clearly separated. The viewer has room for content and works on mobile.
- Loading, unavailable preview, signed URL renewal, keyboard navigation and focus handling belong in each slice.
- Existing scanning, link powers, expiry and direct-to-storage byte delivery remain the governing rules.

## How to use this plan

Before starting a chunk, read its specs, check its dependencies, and use **Done when** as the acceptance checklist. Each UI chunk must be played through in a browser before starting the next chunk. Update behaviour badges and any affected flow contract in the same change that implements the behaviour.

Session rules:

- Execute one chunk per session unless two genuinely small chunks are explicitly combined.
- Keep UI and the supporting service behaviour together; do not leave usable screens for a later UI pass.
- Preserve unrelated changes in the current dirty checkout. Do not create a branch, commit, push or deploy without the user's instruction.
- Use the existing meatsack design language. Changes to generated brand components start in the canonical brand source and use `pnpm sync:brand`.
- Choose worthwhile tests using `calm-craft:write-tests`; use existing Vitest patterns for service logic and browser verification for interactions. Cosmetic changes do not need tests that mirror markup.
- No database schema changes or migrations are planned. Preview state is temporary client state; original transfer records and objects remain the source of truth.
- Deferred previews become executable only when the user includes them in an assignment. Do not introduce conversion infrastructure during core viewer work.

## Phase map

| Phase | Chunks | Focus | Demonstrable result |
| --- | --- | --- | --- |
| A — Contract | A0 | Viewing spec, flows and consequential decisions | A reviewable contract for file count, file family and access states |
| B — File browser | B1–B3 | Spacing, shared surface, collection navigation and renewable read access | Both authorised surfaces offer usable file browsing and downloads |
| C — Core viewers | C1–C4 | Images, video, audio, Markdown and source | One file opens naturally; collections switch between usable viewers |
| D — Documents and release | D1–D3 | PDF, tables and complete journey verification | The core release works across content types, devices and failure states |

## Spec inventory and ownership

| Spec | Role in this feature |
| --- | --- |
| `specs/transfers/files/viewing-files.md`, id `transfers-files-viewing-files` | Owns viewer choice, count-dependent layouts, collections, readers, accessibility and preview failure/recovery |
| [Moving files](../specs/transfers/files/moving-files.md) | Owns storage, limits, scan gating, unscanned-large-file labels and signed URL rules; especially B6–B12 |
| [Sending files](../specs/transfers/sends/sending.md) | Owns public download access, individual downloads, expiry, cancellation and manage links; especially B4–B8 and B12 |
| [Requesting files](../specs/transfers/requests/requesting.md) | Owns upload/agent capability boundaries and retained accepted files; especially B5–B9 and B12 |

The viewing spec now has `status: implemented` and numbered behaviours B1–B19. Verification evidence and release limitations are recorded in [the implementation report](../.reports/file-viewer-implementation-verification.md). The references below map each chunk to that contract. Do not invent implemented badges from this plan or rewrite existing transfer lifecycle flows unnecessarily.

### Chunk A0 — Write the viewing contract

**Status:** 🟢 complete — 2026-10-06. Authored 19 future behaviours, two flows and a generated diagram; validated all 18 states and 52 transitions. [Verification evidence](../.reports/file-viewer-a0-verification.md).

**Depends on:** None.

**Spec(s):** All four specs above; the viewing spec is authored in this chunk.

**Work:**

- Write `viewing-files.md` in the repository format, with behaviours, invariants and decision tables for one/many files, file families, mixed collections, preview availability and access states.
- Define MIME/extension classification, conflicting or missing type metadata, selected-item navigation order, default views, filtering and browser history. Unknown or undecodable files must retain a truthful fallback.
- Make the access table explicit: public send access follows its live ready state; private access follows the existing agent rules, including accepted files retained after expiry/cancellation. The design's blanket “no new access after expiry” statement must be narrowed to public access, rather than silently changing the private contract.
- Specify bounded preview budgets and safe Markdown/HTML/link behaviour. Settle attachment resolution and off-site embedded media policy before implementing the reader.
- Add `viewing-files.flow.yaml` covering direct view, collection → viewer → return, failures/renewal and loss of access; link it and the new spec from the relevant index. Use an owning generator for any `.flow.mmd`; identify the generation workflow before producing a diagram, since no local render script is currently present.

**Done when:** A reviewer can follow one image, a video collection, a mixed batch, a blocked file and an expired public link through the contract. Each active requirement maps to a numbered behaviour; unresolved renderer/budget decisions identify the chunk they block. Deferred previews appear as future context. No implementation code changes.

**Out of scope:** Building viewers, altering scan policy, changing private retention rules, cleaning up the whole spec estate.

## Phase B — File browser

### Chunk B1 — Shared file surface and spacing

**Status:** 🟢 complete — 2026-10-06. Desktop/mobile send and private request checked; no overflow, independent actions and 44px footer links; uploader receipt has no download. Typecheck, scoped lint and brand drift check passed.

**Depends on:** A0.

**Spec(s):** Viewing B1–B2, B6–B8, B19: file details, fallback, responsive layout; Sending B4–B5/B12; Requesting B8/B12.

**Work:**

- Replace the duplicated file markup in `src/app/s/[transferId]/page.tsx` and `src/app/s/[transferId]/manage/page.tsx` with shared file components, using safe view metadata from their existing authorised loaders.
- Give the viewing area a wider `TransferShell` layout in `src/components/transfer-chrome.tsx`; retain a readable inner width for text and suitable sizing for upload/status screens.
- Separate wrapping filenames, readable file sizes, scan labels and Download original. Build single-file fallback and collection rows for every file type, including files visible privately but blocked from access.
- Improve footer click spacing in canonical `meatsack-brand/components/site-chrome.tsx` through the app's brand workflow. Check the other brand consumers before choosing a shared footer change; never edit generated `src/components/site-chrome.tsx` directly.

**Done when:** Open a public send and a private received request on desktop and a 390px-wide viewport. Long filenames wrap without touching Download; scan labels and footer links remain readable and separately focusable. A lone unknown file has a clear primary download action. The upload receipt exposes no private file access.

**Out of scope:** Rich previews, collection search, redesigning the homepage or brand, altering uploads.

### Chunk B2 — List/Grid and selected-file navigation

**Status:** 🟢 complete — 2026-10-06. One/two/100-file surfaces, filters, List/Grid, empty results, keyboard navigation/focus return and Back/Forward checked in local browser; mobile viewer has no overflow. Eight collection/classification tests, scoped lint and typecheck passed.

**Depends on:** B1.

**Spec(s):** Viewing B2–B5, B19: count-dependent layout, collections, navigation, history and focus.

**Work:**

- Add List/Grid selection and type icons; use Grid for visual-only collections and List for audio/document/mixed collections. One file hides collection controls and opens its fallback stage directly.
- Add offered-order/name sorting, filename search and type filtering for collections under the thresholds defined in A0. Keep all types discoverable in mixed transfers.
- Open an item into a selected-file stage with Back to files, previous/next and item count; navigate the current filtered/sorted set and handle an empty result or removed selection explicitly.
- Preserve collection scroll, search, sorting, filter and focus on return. Encode only non-secret view state such as file ID/view/filter in browser history; integrate Back/Forward and refresh without spreading manage tokens to other routes.
- Build responsive viewer controls, keyboard opening/closing and focus return now. Reserve media key handling for the relevant viewer so native player controls remain usable.

**Done when:** Browse fixtures with 1, 2 and 100 files. Switch views, search, sort, filter, open a file, navigate and return; the previous collection state is restored. Repeat with keyboard, mobile and browser Back/Forward. A mixed batch still exposes its documents beside media.

**Out of scope:** Fetching all media to manufacture thumbnails, renderer implementations, persistent user preferences/accounts.

### Chunk B3 — Authorised preview URLs and recovery

**Status:** 🟢 complete — 2026-10-06

**Depends on:** B2.

**Spec(s):** Viewing B7–B9, B18: loading/fallback and renewal; Moving files B6–B12; Sending B6–B8; Requesting B5–B9.

**Work:**

- Extend the transfer/object-store contracts to mint a read URL for a specific authorised file and purpose, returning its expiry. If a new HTTP route is required, make it a distinct read-URL route: existing `refresh-url` refreshes uploads and must retain that meaning.
- Reuse service capability and scan checks. Public send tokens, agent tokens and public request upload tokens must retain their separate powers; foreign IDs and bad tokens must not reveal file metadata or storage keys.
- Support preview versus original-download response headers in the owning object-store code, with safe filename handling. Preserve actual original-download behaviour for cross-origin objects and never execute active files as same-origin documents.
- Add a shared client loader with loading/error/retry states, deduplicated renewal and bounded retries. Renew on expiry/access failure rather than looping on decode or parse errors; abort stale requests and clean up object URLs when selection changes.
- Verify browser GET/HEAD/range access against R2 and inspect required CORS headers. File bytes continue directly between browser and storage; the production app does not proxy them. Keep the local memory-store route suitable for small fixtures, without treating it as proof of production range streaming.

**Done when:** The fallback stage can request and renew access without losing selection. Service tests cover public-send, private-agent, upload-token, foreign-file, blocked-scan and expiry cases. In a browser, a forbidden renewal stops access with explanatory UI; a permitted renewal recovers. Original download returns the expected bytes and filename. No token/key appears in logs or new public view-state parameters.

**Out of scope:** Changing existing agent retention, granting read access to request upload links, thumbnail/conversion servers, proxying large files.

## Phase C — Core viewers

### Chunk C1 — Images and gallery

**Status:** 🟢 complete — 2026-10-06

**Depends on:** B3.

**Spec(s):** Viewing B5, B9–B11, B18–B19: still/animated images, galleries, zoom and accessible navigation.

**Work:**

- Add fitted single-image viewing, zoom/pan and fullscreen or equivalent accessible expanded view, with clear loading and decode-error fallbacks.
- Add gallery thumbnails/filmstrip and visible previous/next controls. Load thumbnails within the A0 network budget; full-resolution neighbours are not fetched indiscriminately.
- Define animated image presentation under reduced-motion settings. Collections use a still poster when cheaply available or a labelled type tile; only the opened item animates.
- Include keyboard/touch navigation, focus restoration and image retry/URL renewal. Keep controls usable at zoom and distinguish image pan gestures from collection navigation.

**Done when:** One image opens fitted without cropping. A multi-image transfer provides an overview and a navigable gallery; mixed collections still reach non-images. Large/invalid images fail gracefully. Mobile, keyboard and reduced-motion checks pass within the chosen budget.

**Out of scope:** Server thumbnail generation, guaranteed HEIC/RAW/PSD support, visual editing.

### Chunk C2 — Streaming video

**Status:** 🟢 complete — 2026-10-06

**Depends on:** B3; C1 provides the reusable filmstrip before completing collection presentation.

**Spec(s):** Viewing B5, B7–B9, B12, B18–B19: video, playback lifecycle, streaming and unsupported codecs; Moving files B9/B11.

**Work:**

- Add a prominent single-video player with native playback controls and no autoplay. Collections open one selected player using a poster if already available, otherwise a video tile.
- Pause and release the previous player on switch/close; preserve playback position where possible during allowed URL renewal. Distinguish codec failure from network/access failure and offer the original file.
- Keep preloading bounded. Do not download every video for thumbnails or buffer the complete original through JavaScript before playback.
- Validate real R2 seeking/range behaviour and the supplied `/Users/gaz/Downloads/Day 23 - Thurs 24th.mp4` without copying it into the repository. Use separate authorised test fixtures for the over-500-MiB unscanned case.

**Done when:** The supplied video starts and seeks in the intended browsers; network inspection shows partial-content/range behaviour. Two videos switch without overlapping playback, and a 100-video collection does not eagerly fetch them all. An unsupported codec has a useful fallback. A renewable expired URL resumes near the prior time; lost public access stops playback. The too-large-to-scan label remains visible.

**Out of scope:** Transcoding, generated posters, adaptive bitrate pipelines, inventing captions that were not supplied.

### Chunk C3 — Audio playback

**Status:** 🟢 complete — 2026-10-06

**Depends on:** B3 and the playback lifecycle work in C2.

**Spec(s):** Viewing B5, B7–B9, B13, B18–B19: audio, playlist selection and playback lifecycle.

**Work:**

- Add a compact single-file audio player and an audio collection list with duration only when available.
- Reuse renewal and playback cleanup; selecting another track or leaving the viewer stops the prior track, including when navigating to a video.
- Verify native controls, keyboard operation, loading, unsupported formats and mobile layout.

**Done when:** One track plays through usable controls. Selecting another audio/video file leaves exactly one active player. Closing, navigation, URL renewal and unsupported-format fallback work without losing the current collection position.

**Out of scope:** Waveform analysis, crossfade, autoplay queues, audio conversion.

### Chunk C4 — Markdown, text and source reader

**Status:** 🟢 complete — 2026-10-06

**Depends on:** B3 and A0's preview budgets/embedding policy.

**Spec(s):** Viewing B5, B7–B9, B14–B15, B18–B19: Markdown, text/code, attachment references, active documents and bounded readers.

**Work:**

- Select maintained Markdown/highlighting libraries against the current toolchain, then install with the repository-pinned pnpm. No unrelated dependency upgrades or hand-edited lockfiles.
- Render Markdown headings, lists, tables, links and code blocks with Rendered/Source controls. Disable executable raw HTML, restrict protocols, and enforce the A0 policy for remote content and same-transfer attachment resolution.
- Add readable plain text/log/code/JSON/YAML/XML previews, with highlighting when recognised and a plain-text fallback. HTML receives source/download treatment; no shared script is executed.
- Fetch and decode only within the agreed byte/line limits, aborting the reader at the limit. Show partial-preview notices, Copy with a clear scope, original download and meaningful encoding/parse errors; retain reading position where practical.

**Done when:** Open Markdown containing tables, fenced code, malformed links, raw HTML, a same-transfer attachment, a missing asset and an ambiguous filename. Safe cases render; unsafe content stays inert. Large text shows a labelled bounded preview without fetching the entire file. Source toggling, keyboard navigation, mobile overflow and access recovery are usable.

**Out of scope:** Running code, HTML publishing, unrestricted remote embeds, previews of Office files.

## Phase D — Documents and release

### Chunk D1 — PDF reader

**Status:** 🟢 complete — 2026-10-06

**Depends on:** B3 and A0's PDF limits/renderer decision.

**Spec(s):** Viewing B5, B7–B9, B16, B18–B19: PDF, page navigation and bounded document rendering.

**Work:**

- Choose a browser PDF renderer that meets the promised page/zoom controls and direct-storage requirements; document its worker, CSP and range-access needs. Do not depend on an inconsistent embedded-browser UI for controls the spec promises.
- Add selected-document page count, page navigation, zoom and download; keep file-to-file navigation distinct from page navigation.
- Bound document size/rendering cost, render pages on demand and release workers/resources when switching. Handle corrupt, encrypted, unsupported and over-budget documents with an honest fallback.

**Done when:** A single PDF and a collection open with usable page controls on desktop/mobile. Switching documents does not confuse page numbers or leak resources. Large/corrupt/encrypted fixtures receive the specified limited or unavailable preview. Direct R2 access and renewal work without introducing a service byte proxy.

**Out of scope:** OCR, annotation, editing or a server PDF-conversion service.

### Chunk D2 — CSV/TSV tables

**Status:** 🟢 complete — 2026-10-06

**Depends on:** B3 and A0's table limits.

**Spec(s):** Viewing B5, B7–B9, B17–B19: bounded tables and parse failures.

**Work:**

- Select a parser supporting quoted fields, delimiters, embedded newlines and the chosen encoding rules. Enforce byte/row/column limits while reading, before large allocation.
- Add a read-only table with header policy, horizontal scrolling, a partial-preview notice and original download. Preserve literal cell values and keep spreadsheet formula-like strings inert.
- Integrate table selection with the existing file reader, keyboard controls and renewal/fallback states.

**Done when:** Open CSV/TSV fixtures with quotes, multiline cells, missing headers, very wide rows and malformed content. A large table stops at its budget and states what is omitted. One and multiple table files work on mobile without horizontal page overflow; cells never execute HTML or formulas.

**Out of scope:** Excel sheet tabs, table editing, import workflows, charts or formula evaluation.

### Chunk D3 — Complete journey verification and release readiness

**Status:** 🟢 complete — 2026-10-06. Combined send/request journeys, scan transitions, recovery and mobile focus verified; all self-review findings resolved. 148 tests, types, lint, format and the webpack production build pass. Default Turbopack build is blocked by the local worker port restriction. [Evidence and browser/deployment limits](../.reports/file-viewer-implementation-verification.md).

**Depends on:** B1–B3, C1–C4, D1–D2.

**Spec(s):** All active viewing behaviours and the linked transfer contracts.

**Work:**

- Exercise send → upload/scan → public viewing/download and request → uploader receipt → private manage viewing/download. Include files changing from scanning to available, blocked scans, skipped-too-large and existing terminal states.
- Run the fixture matrix below in representative supported browsers, desktop and mobile, keyboard and reduced-motion modes. Measure cold collection opening, selection changes and cleanup against A0 budgets; fix in-scope failures.
- Confirm signed URL recovery, public expiry/cancellation, retained private access, file removal, page refresh and Back/Forward. Check both UI behaviour and underlying capability responses.
- Run the configured gates, inspect the complete feature diff and generated brand/dependency changes, and update spec badges to the verified state. Record verification steps and remaining limitations in `.reports/`. Prepare a concrete release result; deployment remains a separate authorised action.

**Done when:** Both complete journeys pass, all active acceptance rows have evidence, and configured gates pass or pre-existing unrelated failures are identified with evidence. No eager whole-video collection download, token leakage, scan bypass or unexpected private-retention change remains. The user can review the final UI and release notes before deployment.

**Out of scope:** Deferred renderers, unrelated checkout cleanup, sending links to other people, an unauthorised production deployment.

## Suggested execution order and milestones

```text
A0 → B1 → B2 → B3 → C1 → C2 → C3 → C4 → D1 → D2 → D3
                └──────── C4 / D1 / D2 depend on B3, not each other
```

The ordered path is a sensible session sequence, not a requirement to run separate agents. Dependencies above determine which work can start.

**Next up:** None in phases A–D. Review the local result; production deployment is a separate action. Deferred renderers remain outside this assignment.

- **First visible improvement — B1:** Readable file rows, independent download actions and spaced footer links on both surfaces.
- **File browser milestone — B3:** List/Grid, selection and navigation work with authorised, renewable file access.
- **Core viewing milestone — C4:** Images, video, audio, Markdown and source work singly and in collections.
- **Release candidate — D3:** PDF/tables join the complete verified experience.

## Verification matrix

| Dimension | Cases |
| --- | --- |
| Count/composition | One file; two files; 100 files; all images; all videos; audio; documents; mixed; zero visible/takeable files; empty search result |
| Presentation | Long/non-ASCII names; odd aspect ratios; large image; portrait video; wide code/table; light/dark; narrow mobile; zoomed text |
| Access/scan | Correct public send token; correct private agent token; upload token; foreign file; bad token; scanning; clean; infected; failed scan; >500 MiB flagged; expiry/cancellation; retained private files |
| Failures | Storage error; expired URL; unsupported codec; corrupt/over-budget document; malformed text/table; missing Markdown attachment; interrupted request; rapid selection changes |
| Interaction | Mouse/touch; keyboard/focus return; native player keys; reduced motion; browser Back/Forward; refresh; scroll/read/playback position; download original |
| Resource use | No simultaneous players; bounded previews; no eager video downloads; direct storage ranges; cancelled stale fetches; released blobs/workers; clean console |

Use small non-sensitive fixtures for repeatable checks. Keep the user's supplied video and temporary screenshots outside the repository. The local object route is a convenience for small fixtures; actual R2 network evidence is required for the large-file path.

## Decisions to resolve during execution

Track decisions in the new spec's Open Questions and resolve them before the dependent behaviour is marked implemented.

| Topic | Default or required decision | Deadline |
| --- | --- | --- |
| Surfaces | Settled in B1: shared viewer on sends and private manage pages, including received requests; public uploader remains upload/receipt only | A0 complete |
| Expiry/access | Settled in B8: existing public/private distinction preserved; related moving-files wording clarified | A0 complete |
| Type classification | Settled in B7/classification table: recognised MIME first, generic MIME permits extension hint, conflicting types fall back, active content stays inert | A0 complete |
| Budgets | Settled in B18/budget table: explicit text/table/PDF/image and request limits; original download remains available | A0 complete |
| Markdown assets | Settled in B14: exact unique stored filename only, no traversal, blocked/missing/duplicate placeholders, remote images are links | A0 complete |
| Libraries/browsers | Settled: bounded client readers; Chrome 154 desktop/mobile viewport exercised. Physical Safari/Firefox/mobile validation remains a release limitation | C/D complete; see report |
| Thumbnail strategy | Settled: visible small static-image thumbnails; type tiles for large/animated images and media; no server pipeline or whole-video poster fetch | B2/C1/C2 complete |
| Flow generation | Generated through the existing Cleanroom renderer with a temporary input-path adapter; YAML remains authoritative. Portable plugin integration remains a tooling follow-up | A0 complete; see verification report |
| Footer ownership | Settled: canonical submodule footer source updated; owning brand generator refreshed the app copy | B1 complete |

## Deferred roadmap

These are future design topics, not additional executable chunks in A–D. Until separately scoped, all have clear type cards and original downloads.

| Family | Later experience | Prerequisite |
| --- | --- | --- |
| Excel/workbooks | Read-only table with sheet tabs inside one selected workbook | Safe parser, workbook limits and honest formula/formatting policy |
| Word/rich documents | Read-only document rendering | Fidelity limits and a privacy-preserving renderer/conversion design |
| PowerPoint/slides | Slide thumbnails and selected-slide view inside one deck | Bounded rendering and distinct deck/slide navigation |
| Archives | Contents listing without silently expanding the transfer | Compression/path safety and bounded inspection; no download-all archive |
| Specialist visuals/assets | Safe previews for HEIC/RAW/TIFF/PSD/CAD/3D where justified | Codec/conversion support, cost, privacy and failure policy |
| Generated thumbnails/captions | Better posters and supplied subtitle association | Separately designed storage/processing lifecycle and authorised file access |

No private file goes to an external conversion service merely because a person opens a viewer. Any later processing pipeline needs its own spec and assignment.

## Per-chunk completion checklist

- [x] Dependencies complete and linked specs read; new viewing behaviour IDs recorded after A0.
- [x] UI behaviours demonstrated using the chunk's Done when checks.
- [x] Permission/scan/renewal changes have meaningful service regression coverage.
- [x] Applicable type, lint, test, format and build checks completed; no repository-wide formatting.
- [x] Spec badges and affected authoritative flows reflect what actually works.
- [x] Canonical sources changed and generated files regenerated only through owning tools.
- [x] Complete scoped diff inspected; unrelated changes and secrets preserved.
- [x] Limits, fallbacks and browser evidence recorded; no deferred work pulled into scope.
- [x] No commit, push, PR or deployment without an explicit instruction.
