# File viewer implementation verification

## B1 — Shared surface and spacing

Verified local public single send and private received request at 1280×900 and 390×844. Both had no horizontal page overflow. File details/download actions were separate; all footer anchors measured 44px height. Request public receipt had zero download actions. Screenshots: `/private/tmp/share-viewer-B1-{single,request}-{1280,390}.png`. Typecheck, scoped oxlint and brand owning `--check` passed. Cosmetic changes verified in browser without markup-mirroring tests. Canonical source changed in the app brand submodule; generated app copy refreshed by its owning command. No other product checkout was changed.

## B2 — Collections

Verified one-file direct stage, two-file private collection and a 100-file mixed send. List/Grid, case-insensitive filename search, type filter, name sort and empty-result reset worked. Opening a Markdown item and ArrowRight selected the next item in the filtered set. Browser Back restored filter/sort and focus to the last viewed item; Forward restored that selected file. Escape closed it. A 390px viewport had no page overflow; screenshot `/private/tmp/share-viewer-B2-mobile.png`. Eight decision-table tests passed; scoped oxlint and typecheck passed after accessibility corrections. Heavy previews remain unloaded until their chunks.

## B3 — Authorised reads (2026-10-06)

Service and route tests cover separate public send, private retained, public upload, foreign-file, blocked-scan, cancellation and expiry powers. 53 affected tests passed; 11 client resolver/classification tests passed. Typecheck and scoped lint passed. Browser verified a transient invalid read response recovers with Retry without changing selection, and cancellation denies fresh access, removes the download action and explains the loss. Local original bytes and RFC UTF-8 filename disposition were checked.

Real production R2 GET range checks returned 206 for a 32-byte fixture and 1024 bytes of the supplied 482,663,402-byte MP4, with expected Content-Range and production-origin CORS. GET signatures cannot be reused for HEAD; the service signs HEAD separately. CORS currently exposes ETag only: PDF range metadata may require bounded full-document reads. New response overrides need production smoke verification after a separately authorised deployment. No production change is claimed here.

## C1 — Images (2026-10-06)

Browser: a 900×450 PNG fits without cropping; Grid/filmstrip reach images and a Markdown file; zoom, pan and expanded-view Escape work. Corrupt PNG explains decode failure and keeps download. Reduced-motion GIF uses an explicit Play animation action. At 390×844 document width remains 390; inspected screenshot `/private/tmp/share-viewer-C1-mobile.png`. Native touch swipe at fit complements buttons; zoom uses pan instead. Blob URLs and fetches are released on exit. Four shared image slots, visible-only thumbnail requests and size limits are enforced. Three meaningful bounded-stream/concurrency tests pass, typecheck and scoped lint pass (sequential stream-read warnings only).

## C2 — Streaming video (2026-10-06)

Chrome 154: the supplied 482,663,402-byte R2 MP4 loaded native metadata (79.892411 s, 2688 px wide), played following a user gesture and sought to 60.000924 s. Captured real browser storage responses were 206. Screenshot `/private/tmp/share-viewer-C2-r2.png`. The local metadata endpoint was mocked to return the existing authorised production URL; original bytes came directly from R2. A first attempted check reused a cached small local URL; that result was rejected and the real-origin check repeated with a fresh document.

Two local videos switch with exactly one paused new player; a corrupt MP4 yields a useful codec fallback. A 100-video collection opens with zero players and zero object requests. Native controls, metadata preload and no autoplay remain. Setup/cleanup was corrected for React development effect rehearsal; URL changes preserve desired time/play state. Typecheck and scoped lint pass. Chrome desktop/mobile viewport is the exercised release target; physical Safari/Firefox checks remain a release limitation, not claimed evidence.

## C3 — Audio (2026-10-06)

A three-second WAV played through native controls. Selecting a second track left one paused new player; switching to video removed audio; Escape left zero players. Corrupt WAV produced a codec/download fallback. At 390×844 there was no horizontal page overflow; screenshot `/private/tmp/share-viewer-C3-audio.png` inspected. Compact controls share metadata-only preload, renewal and cleanup with video. Typecheck and scoped lint pass.

Additional media recovery check: a deliberately injected native network-error event renewed the read URL and resumed from 1.307222 s to 1.992779 s while playing, with exactly one player. This exercised lifecycle recovery independently of storage URL TTL.

## C4 — Markdown/source (2026-10-06)

Chrome desktop/mobile: tables, lists and fenced code render; Source toggles and Copy announces the scope/success. Raw HTML remains inert source; unsafe protocols, missing/duplicate/traversal links are unavailable. A same-transfer source link opens Code.ts, authorised still image embeds as a thumbnail, animation stays an explicit action, and remote image is an external no-referrer link without an automatic load. Received-request private Markdown also renders.

UTF-16LE BOM text displays `Hello é`; invalid encoding explains the failure. A 1.2-MB log shows the 1-MiB/10,000-complete-line partial notice; streaming now cancels at the first applicable byte/line cap. A 4,000-character line scrolls inside source while the page stays 390 pixels wide. Screenshot `/private/tmp/share-viewer-C4-markdown.png` inspected. Token highlighting uses app text tokens and additional visual styles rather than fixed light-theme colours.

Explicit attachment jumps clear search/type filters in the current viewer entry so the destination remains valid on reload. Back to files restores the prior list entry and its filters; sort/view remain unchanged.

C4 checks: 12 relevant decoding/link/stream tests passed; typecheck and scoped formatting/lint passed (sequential bounded-read warnings only). New maintained reader dependencies are react-markdown 10.1.0, remark-gfm 4.0.1 and prism-react-renderer 2.4.1; lockfile regenerated by pinned pnpm.

## D1 — PDF (2026-10-06)

Single three-page PDF rendered with the same-origin PDF.js 6.4.299 worker. Page 2, 125% zoom and 390×844 layout passed; one canvas remained within 16MP. Switching PDFs reset page count to the new document, rapid render work is queued/cancelled, and closing left zero canvases. Encrypted/corrupt/501-page/>50MiB fixtures each received the intended fallback; the oversized original made zero object requests. Screenshot `/private/tmp/share-viewer-D1-mobile.png` inspected.

A new non-sensitive production PDF scanned clean. From the production browser origin R2 returned 206 and exactly 2,496 bytes; SHA-256 matched the original. Local renderer and production-origin byte access were verified separately; new UI is not deployed. PDF preview fetches one complete selected document up to 50MiB directly from storage because current CORS exposes ETag only. Three raster-bound tests, typecheck, scoped lint and format pass.

Worker/CMap/font/WASM/ICC assets are generated from the installed package by `sync-preview-assets.mjs`; dev/build run it, generated public copies are ignored. Future restrictive CSP must permit self workers/assets and storage connect-src. PDF.js 6 removes evaluation; forms/XFA/annotations are disabled, oversized embedded rasters omitted with a notice. No CDN or file conversion service receives originals.

## D2 — Tables (2026-10-06)

Single/collection/private-request CSV and TSV opened. Browser checks preserved commas, escaped quotes and multiline values; HTML and formula-like values stayed literal. First row is data retained the header and switched to numbered columns. Duplicate/empty headings remained distinguishable by position. A 150-column file showed 100 columns and a notice; a 20,000-character cell was visibly shortened; a 3-MB file displayed 1,000 rows and the partial notice. UTF-16LE TSV decoded correctly; unclosed quoting explained the parse failure. Every mobile case stayed within 390px document width with internal table scrolling. Screenshot `/private/tmp/share-viewer-D2-mobile.png` inspected.

Papa Parse 5.7.0 is fed bounded complete records, with discarded columns removed before parser allocation. Streams cancel at complete row boundaries or 2MiB; incomplete quoted records at a limit are omitted. Twenty table/text/stream tests, typecheck, scoped lint and eight-file formatting check passed. Text decoding now shares fatal byte decoding and parse/decode errors do not cause URL renewal.


## D3 — Complete journeys and release readiness (2026-10-06)

The combined 11-file send exercised List/Grid, filename search, sorting, PDF pages, browser Back/Forward and focus restoration on the compiled production UI. Back restored Grid, the `Guide` search and the Guide.pdf opener; Forward restored the selected PDF. Markdown rendered and opened its video attachment. Native video started paused with metadata preload, played, and switching to audio left exactly one three-second track. Selecting CSV removed media and displayed three literal rows, including a formula-like value. A real 42-megapixel PNG received the 40-megapixel fallback. Mobile image expansion/closing retained transfer context, stayed 390px wide and released body overflow/inert state. Single image opened directly without collection controls. Desktop/mobile screenshots were inspected at `/private/tmp/share-viewer-final-{desktop,mobile}.png`.

The received-request public receipt lists accepted filenames with zero viewer/download actions; its upload token receives 404 from read-url. The private request link rendered the received three-page PDF. Its original download matched all 2,496 bytes and the Guide.pdf attachment filename. A controlled local scanner changed a waiting send to ready through the existing page refresh. Infected and failed-scan files remained visible privately with truthful blocked labels, no selected-file download and 404 read responses. Scanner fixtures are test doubles, not malware-engine validation.

Separate >500-MiB verification uploaded a 524,288,001-byte non-sensitive padded MP4 through the local API. Native metadata/play area remained available with `Not scanned — too large`, duration four seconds and metadata preload. This does not relabel the original supplied 482,663,402-byte video as oversized; that video’s real R2 play/seek/range evidence is recorded in C2.

A deliberate lazy renderer chunk failure displayed the local preview boundary while retaining Back to files and Download original. Cancellation during media renewal removed playback and read actions with an explanatory unavailable state. The service suite covers public expiry and retained private access after expiry/cancellation. Pure collection tests cover unknown selections and filtering; review confirmed nearest surviving focus logic.

Self-review found and resolved transient R2 HEAD errors being mapped to permanent denial, missing-item focus restoration, hidden mobile transfer context and nested overlay cleanup. Non-404 R2 errors now return retryable service unavailability; malformed HEAD metadata also remains retryable. Reference-counted overlay ownership preserves base inert/overflow state across both cleanup orders. Browser route exit while an image was expanded restored normal overflow with zero inert nodes; Escape restored Expand image focus, then the collection opener. The follow-up review reports zero outstanding Critical/Major/Minor findings in `file-viewer-self-review.md`.

### Final gates and source ownership

- `pnpm typecheck`: pass.
- `pnpm lint`: pass, warnings only; no import-layer errors.
- `pnpm format:check`: pass, 127 files. Canonical footer formatting was corrected in the brand source and regenerated; generated copies were not hand-edited.
- `pnpm test`: pass, 28 files / 148 tests.
- Brand owning tests: six pass; generated brand outputs match.
- `pnpm build --webpack`: pass, compiled and generated every route. Owning asset/icon/skill/brand generators ran first.
- Default `pnpm build` (Turbopack): local environment failure while its CSS worker binds a port (`Operation not permitted`), including on an escalated attempt. The webpack build is the verified production-build alternative; no unrelated build configuration was changed to hide that restriction.
- Complete scoped source/dependency/brand diff and whitespace inspected. YAML flow source remains authoritative; owning regeneration produced an identical Mermaid diagram. No schema/migration change, commit, push, PR or deployment.

Production mode correctly refuses file creation without configured object storage. To exercise the compiled UI without using production credentials on this laptop, a temporary preload outside the repository supplies local in-memory storage and scanner fixtures. The review server is bound to 127.0.0.1:43170. No production configuration guard or product source was changed for this harness. Temporary verifier navigation races were discarded and request/scan checks repeated in independent sessions with explicit visible-content waits.

### Release limits and next deployment checks

Chrome 154 desktop and a 390×844 mobile viewport are the exercised targets; light/dark and reduced-motion were checked. Physical mobile devices, Safari and Firefox remain unverified. Codec support is browser-dependent and the UI retains original downloads when decoding fails. Host Node is 26.7.0; repository CI is Node 22, and PDF.js requires a current Node 22 release (22.13 or later).

Actual R2 byte/range delivery is verified separately from the locally served new application. The new read-url route and response header overrides are not deployed. After a separately authorised deployment, smoke-check public/private renewal, cross-origin original-download attachment filenames and new R2 response overrides on the deployed app. Keep PDF worker/assets present in the generated deployment; any future restrictive CSP must permit self workers/assets and storage connections. Current R2 CORS exposes only ETag, so bounded PDFs use a selected-document full read rather than depending on inaccessible range metadata.

All 11 executable chunks in phases A–D are complete. Office, archive-content, specialist/conversion previews and generated posters remain deferred as agreed; their originals use clear file cards and permitted downloads.


## PR submission (2026-10-06)

Submitted sharemeatsack PR #5 (https://github.com/garylesueur/sharemeatsack/pull/5), commit c1601a8, from an isolated worktree based on updated origin/main a7a9fee. Canonical footer dependency is meatsack-brand PR #3 (https://github.com/garylesueur/meatsack-brand/pull/3), commit f9cfed0; its generator refreshed the app copy. Original dirty checkout and unrelated changes were preserved.

All five configured gates pass on this isolated publication state, including the default Turbopack build; the earlier local port restriction did not recur there. Tests: 28 files / 148 passing; brand generator: six passing. Size display uses the existing file-view formatter in this branch, avoiding a missing standalone formatting-module dependency while preserving the same output. Browser evidence above still applies to the implemented viewers; physical browser and deployed R2 smoke checks remain as stated. PRs were submitted for review, not merged.


## Merge conflict resolution (2026-10-06)

Merged updated main 536d4dd into PR #5 with merge commit 0635fd1 and pushed normally. Resolved the two conflicting source files by preserving FileBrowser/FileAccessProvider on the public ready page and adopting main’s shared format-file-size helper for FileSize. File-view’s formatting export now reuses that helper; main’s readable upload-size display is retained. No generated file or lockfile required manual resolution. All five gates pass, including 28 test files / 148 tests and the default Turbopack build. The isolated checkout is clean and the original dirty checkout was not changed.
