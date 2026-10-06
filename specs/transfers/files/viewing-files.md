---
id: transfers-files-viewing-files
area: Transfers / Files
status: implemented
---

# Viewing files

On **sharemeatsack.com**, a person can view, play or read an authorised file and download its original. A single file opens directly; several files form a browsable collection with a viewer for the selected item.

## Behaviours

### B1 — The right link opens the file surface 🟢 implemented

A public send link shows only files that the send contract permits the person to take. The private manage link uses the same viewing experience for its authorised accepted files, including files received through a request. A request upload link retains its upload flow and completion receipt; it does not become a viewer for received files or reveal the agent's secret.

### B2 — One file opens directly 🟢 implemented

When exactly one file is visible to this viewer, its appropriate preview opens immediately. There is no List/Grid switch, filmstrip or previous/next control. If it is blocked, unsupported or outside the preview budget, a useful file card occupies the same stage. A private page with additional blocked files is still a collection, even when only one file is takeable.

### B3 — Several files have List and Grid views 🟢 implemented

A collection shows file count, total listed size and both List and Grid controls. A collection containing only images and videos starts in Grid; audio, documents and mixed collections start in List. Grid uses a safe image/poster when available, otherwise a recognisable type icon. Both views show filenames and sizes, and switching views preserves selection. A collection never silently hides another file family.

### B4 — Collection search, sort and filters keep their context 🟢 implemented

Offered order is the default. Name sorting is available for every collection; equal names retain offered order. Collections with at least ten listed files show case-insensitive filename search. Collections with more than one file family show type filters. Search and filters can produce a clear empty-result state with a reset action. The count shown with filtered results distinguishes matching files from the total.

### B5 — Opening and closing a file preserves the collection 🟢 implemented

Opening a collection item enters its viewer, with Back to files, previous/next, its filename and its position in the current filtered/sorted set. Navigation stops at the ends rather than wrapping. Closing restores search, sort, filter, view, collection scroll and focus to the opened item. If that item disappears, focus goes to the nearest surviving item, then the collection heading if none remain.

Browser Back/Forward follows collection/viewer navigation. Refresh restores valid selected-file and collection state from the current link; an unknown or now-hidden selection returns to the collection with an explanation and never reveals that file. Opening a file adds a history entry; previous/next replaces the selected-file entry. Collection-control changes replace their entry rather than making Back traverse every search keystroke. Private credentials remain confined to the existing private link.

### B6 — File details and actions are readable 🟢 implemented

The transfer title and message remain visible. Filename, readable binary-unit size, scan state and Download original occupy separate, comfortably spaced areas. Names wrap independently of actions. A file above 500 MiB says **Not scanned — too large**, including while previewing; it is never called clean. Blocked private files state why access is unavailable and expose no preview or download action. Footer links have separated click areas and deliberate wrapping.

### B7 — Viewer choice is truthful 🟢 implemented

Viewer choice follows the classification table below. Type labels do not promise that a browser can decode the original. A corrupt file, unsupported codec, conflicting metadata or unknown format produces a useful explanation and file card rather than an empty player. Download original remains available whenever the underlying file is takeable. HTML and other active documents are source or download content, never executable pages from this product.

### B8 — Preview access follows the existing file powers 🟢 implemented

Previewing and renewing access require the same capability, accepted-file and scan eligibility as downloading that file. Public send links stop minting access after expiry or cancellation. Private request/manage access retains the existing agent contract: accepted retained files remain listed and takeable under the same scan rules after expiry or cancellation, while their objects exist. This feature does not promise longer retention or resurrect a deleted object.

An infected, failed-scan, still-scanning, foreign or unknown file receives no read URL. Invalid links do not reveal another transfer or file. Original download and preview read directly from storage; service responses contain metadata and temporary links, never the original bytes.

### B9 — Loading, failure and URL expiry have usable outcomes 🟢 implemented

A selected preview has an announced loading state, a cancel/back exit, and bounded recovery. No-progress loading becomes a retry/download fallback after 30 seconds; a progressing media stream does not time out merely because playback is long. Retry is offered for recoverable network failures. An unavailable/undecodable preview retains its file details and permitted original download.

When a short-lived URL expires, an authorised viewer can obtain fresh access without losing selection. The viewer preserves reading position, page, zoom and playback position where the renderer permits. A load attempt may renew once automatically; a continuing failure needs an explicit Retry. A decode/parse failure alone does not trigger URL renewal. Loss of permission stops further loading/playback and shows the appropriate unavailable state. Already delivered bytes cannot be recalled, and the viewer does not promise immediate revocation of an existing storage URL.

### B10 — Images have a fitted viewer and gallery 🟢 implemented

A supported still image opens fitted without cropping, with zoom, pan and an expanded/fullscreen view. A collection provides visible gallery navigation and a filmstrip. Swipe complements visible buttons; at zoom, panning does not unexpectedly change the selected file. Raster preview supports PNG (including APNG), JPEG, GIF and WebP only after checking encoded canvas and frame dimensions before browser decoding. SVG, AVIF and other encodings whose decoded allocation cannot yet be verified use a labelled download fallback; SVG is never injected as an active document. An image beyond the stated budget or with unsafe/conflicting metadata has a labelled fallback.

### B11 — Animation respects selection and motion preferences 🟢 implemented

An animated GIF/WebP is labelled as animated. Collection tiles use a cheap still poster when one exists or a labelled type tile; they do not start many animations. Only the opened animation runs. Under reduced-motion settings it starts as a static poster or fallback, with an explicit action to play the animation. Switching or closing releases the animated preview.

### B12 — Video plays one selected original 🟢 implemented

A supported single video occupies the main stage with Play, timeline, volume and expanded/fullscreen controls. It does not autoplay. A collection opens the selected video in the same stage with gallery navigation and poster/type tiles. Selecting another file, closing the viewer or leaving the page stops and releases the previous player. Seeking and playback use direct storage range access; opening a collection does not fetch whole videos to create posters. Unsupported codecs retain a useful download fallback.

### B13 — Audio has one active track 🟢 implemented

A single audio file has a compact player with playback, timeline and volume; duration appears when known. Audio collections remain browsable as a list or Grid. Selecting another audio or video file stops the prior player. Closing or leaving the viewer stops playback. Renewal and unsupported-format behaviour match the shared rules.

### B14 — Markdown is readable and inert 🟢 implemented

Markdown has Rendered and Source views, headings, lists, tables, links and fenced code. Executable raw HTML is disabled. Navigation links accept only `https`, `http`, `mailto`, same-document anchors and the authorised attachment references described below. Script and other active protocols are inert. Off-site links open separately without exposing private link credentials.

Relative links/images resolve only to an exact, uniquely named file in the same authorised transfer after removing a leading `./`. Comparison is case-sensitive and allows only the stored filename; directory traversal, absolute paths and ambiguous duplicates are refused. A same-transfer document link opens its file viewer. An image embeds only an authorised safely classified image within B10/B18 limits; animated attachments remain labelled placeholders until explicitly opened. Missing, blocked or ambiguous assets show a placeholder; they never broaden access. Document anchors remain in the selected document. Remote images, iframes and embedded media do not load automatically; a remote image is represented by a clearly labelled external link. This reader does not publish a website.

### B15 — Text and code have bounded source previews 🟢 implemented

Plain text, logs, recognised code, JSON, YAML, XML and configuration files have a readable source preview, useful line numbers and highlighting where recognised. Unrecognised text remains plain text. HTML is shown as escaped source. Copy identifies whether it copies the full preview or a truncated preview; Download original gets the complete file.

UTF-8, UTF-8 with BOM and UTF-16 with BOM are supported. Invalid encoding or binary content presented as text produces a clear fallback rather than silently corrupting content. B18 limits apply before the complete original is loaded. An incomplete final line or fenced block is not presented as the full file.

### B16 — PDF page navigation is separate from file navigation 🟢 implemented

A previewable PDF has page count, page navigation, zoom and original download. Moving to another document is distinct from moving to another page. Pages render on demand and the viewer releases prior document resources. Encrypted PDFs receive a download fallback without collecting a password. Corrupt, unsupported or over-budget documents explain why preview is unavailable.

### B17 — CSV and TSV have bounded table previews 🟢 implemented

CSV/TSV display a read-only table with quoted fields and embedded newlines preserved. The first complete row supplies column labels; duplicate/empty labels remain distinguishable by column position. A **First row is data** toggle switches to numbered columns without discarding that row. Horizontal scrolling stays inside the table. Formula-like strings, HTML and links in cells remain literal text.

Partial previews state the byte/row/column limits and offer Download original. Malformed content falls back to a bounded source preview or a parse explanation; a cut caused by the preview limit is labelled truncation, not corruption. Oversized cells are visibly shortened. Separate files are not combined into one table.

### B18 — Preview work has explicit limits 🟢 implemented

The preview budget table applies to the first release. Reaching a budget never prevents an otherwise authorised original download. The person sees what is missing or why preview is unavailable. Opening a collection does not begin loading every file; selection changes cancel stale work and release old resources. The limits do not change the transfer's acceptance ceilings.

### B19 — Viewing works on mobile and with a keyboard 🟢 implemented

Media uses the available viewing width; reading content has a comfortable line length. On a narrow screen, an opened collection viewer fills the available surface with an obvious back/close control. Names, actions and the page never force horizontal page scrolling; wide source/tables scroll internally. Actions have at least 44px touch targets and visible keyboard focus.

Focusable file items open with Enter. Escape closes an opened collection viewer and restores focus; it exits an expanded single-file view without hiding the sole file. Previous/next arrows operate only when focus is on gallery navigation or the viewer stage, not inside text inputs, editable controls or native media controls. No keyboard trap is introduced. Loading, failure, selection and empty results are announced without relying on colour. All gallery actions have visible button equivalents; reduced-motion preferences are respected.

## Rules (Invariants)

- Preview cannot grant more file access than the link's existing download capability and scan rules.
- The public request receipt never reveals the private received-file viewer, agent token or read URLs.
- A large unscanned file is labelled honestly wherever it is viewed or downloaded.
- A failure in one preview does not hide other files or remove permitted original download.
- Original bytes move directly between storage and the browser. Private files are not sent to external renderers/converters merely by opening this page.
- Only one audio/video player or selected animation is active; stale loads and document resources are released on selection change/exit.
- File types and embedded content are untrusted. No shared scripts, HTML or formula-like cell values execute.
- Non-secret navigation state does not replicate private credentials onto public pages, outbound links or unrelated routes.
- Public expiry stops new access; short-lived URLs and already delivered bytes have their own limits on revocation. Private retention is owned by existing transfer contracts.

## Decision Tables

### Count and composition

| Listed files | Composition | Initial presentation | Collection controls |
| --- | --- | --- | --- |
| None | Any | Existing empty/status explanation | None |
| One | Any | Appropriate direct viewer or file card | None |
| Two or more | Images/videos only | Grid | List/Grid, sort, navigation; search at ten files |
| Two or more | Audio, documents, unknown or mixed | List | List/Grid, sort, navigation; search at ten files |
| Two or more | More than one family | As above | Type filters also available |

Counts include private blocked entries when listed. Public eligibility determines which entries are listed before these rules apply. An empty search result is not an empty transfer.

### Classification and fallback

| Metadata | Outcome |
| --- | --- |
| Specific recognised MIME, extension absent or in the same family | Choose that family; renderer must still decode safely |
| Missing/generic MIME (`application/octet-stream`), recognised extension | Use the extension as a preview hint; renderer failure remains a fallback |
| Specific MIME and recognised extension disagree by family | Explain conflicting type; use download/type card, no active preview |
| MIME or extension identifies HTML/active content | Escaped source when bounded text decoding is safe; otherwise download card |
| Neither identifies a safe supported family | Type card and original download |

The active-content row takes precedence; escaped source still requires safe bounded text decoding. Otherwise conflicting specific metadata takes precedence over either type hint. Image classification includes JPEG/PNG/WebP/AVIF/GIF/SVG and recognised still types; inline raster preview currently verifies PNG/JPEG/GIF/WebP headers, while SVG/AVIF and specialist types retain image cards and original download; video/audio include recognised media types without a codec guarantee. Markdown includes `.md`/`.markdown` and recognised Markdown MIME types. Text includes `text/*` and explicitly recognised source/config extensions. PDF and CSV/TSV have dedicated viewers. Office, archives, installers and specialist binary formats initially use type cards; a specialist image is previewed only when safely supported under image limits. The implementation records its explicit extension/MIME list without guessing from file bytes to execute content.

### File access

| Surface/capability | State | File/scan | Result |
| --- | --- | --- | --- |
| Valid public send link | Live ready | Accepted, clean or skipped-too-large | List, preview if supported, download and renewal |
| Valid public send link | Expired/cancelled/not ready | Any | Existing status screen; no new read access |
| Valid request upload link | Any | Any | Upload/status/receipt only, no received-file read access |
| Valid private agent link | Non-open, including expired/cancelled retained entries | Accepted, clean or skipped-too-large; object retained | Private listing, preview if supported, download and renewal under existing agent rules |
| Valid private agent link | Open | Any | Existing status; no accepted-file viewer access |
| Valid private agent link | Non-open | Accepted, scanning/infected/failed scan | Listed as appropriate, blocked from preview/download |
| Any | Any | Foreign/missing/deleted object or invalid capability | No read access; unavailable without another file's details |

This table preserves Requesting B5/B6/B8/B12 and its terminal-state table. Moving files B12 still owns future object destruction: retention here lasts only while the existing contract retains the object. It does not extend object life.

### Preview budgets

| Preview | First-release limit | At the limit |
| --- | --- | --- |
| Markdown/text/source | First 1 MiB of original bytes and 10,000 complete lines, whichever comes first | Label partial preview; discard an incomplete code unit/line at the cut; original download remains |
| CSV/TSV | First 2 MiB, 1,000 data rows, 100 columns; displayed cells limited to 10,000 characters | Label each applicable truncation; complete rows only; widen access through original download |
| PDF | Original at most 50 MiB and at most 500 pages; at most two page render surfaces and 16 megapixels per surface | Over-size/page files use download fallback; zoom stays within raster budget |
| Selected image | Original at most 100 MiB, decoded at most 40 megapixels | Reject over-size before fetching where metadata is known; check encoded canvas/frame dimensions before creating a browser image source; over-dimension, malformed or unverifiable encodings fall back to download |
| Image collection thumbnails | At most four simultaneous requests; original-image thumbnail fetch only for files at most 2 MiB; only visible tiles/filmstrip plus one adjacent row | The same pre-decode dimension check applies to thumbnails; larger/unknown/animated originals use supplied safe still posters or type tiles |
| Video/audio | One active player; metadata only before explicit playback; no client-created whole-original buffer/poster extraction | Native direct storage playback; unsupported seek/codec gets a truthful fallback |
| Other binary types | No byte fetch for a type card | Original download only |

MiB is 1,048,576 bytes. Text/table loading stops at the byte cap even if storage ignores a range request. Embedded Markdown images count toward the same four-request concurrency limit and use the image limits; leaving the document releases them. PDF byte/page limits do not authorise speculative collection loading. These are operational defaults for the first release; changes require updating this contract and its visible partial-preview copy together.

## User Flows

- **F1 — Open a file surface:** [contract](./viewing-files.flow.yaml) · [diagram](./viewing-files.flow.mmd) — covers B1–B3, B6–B8.
- **F2 — Browse and view:** [contract](./viewing-files.flow.yaml) · [diagram](./viewing-files.flow.mmd) — covers B2–B19.

F1 delegates viewing to F2. F2's collection state is used only for multiple listed files; a single file enters its selected stage directly. Transfer upload/seal/scan journeys remain owned by the send/request contracts.

## Open Questions

- **Settled:** Cover both public send pages and private manage pages, including received requests; preserve public uploader permissions.
- **Settled:** Keep existing private retention and scan rules. Public expiry does not become a new rule denying retained private files.
- **Settled:** Remote Markdown images do not load automatically; exact uniquely named authorised attachments may resolve within the transfer.
- **Settled:** The budget table supplies first-release defaults; original downloads stay available under transfer rules.
- **Settled:** PDF.js 6.4.299 renders bounded selected documents using a same-origin worker and assets. Selected PDFs use a full read up to 50 MiB because current storage CORS does not expose the range metadata needed for a range-driven reader. Originals remain direct storage downloads.
- **Settled:** The exercised first-release target is Chrome 154 on desktop and a 390×844 mobile viewport, in light/dark and reduced-motion settings. Codec/format support remains browser-dependent and unsupported originals retain download fallbacks. Physical mobile devices, Safari and Firefox have not been verified; record those checks before claiming support for them.

## Future Considerations

- Office workbook previews with sheet tabs, rich document rendering and slide thumbnails; each keeps file navigation separate from its internal pages/sheets/slides.
- Bounded archive contents inspection without silently expanding an archive into the transfer.
- Specialist image/CAD/3D support and separately designed conversion/privacy/cost rules.
- Generated safe thumbnails/posters and supplied subtitle association with an explicit processing lifecycle.

## Out of Scope

- Changing uploads, malware decisions, accepted file ceilings, link powers or object retention.
- Editing files, executing code/HTML, OCR, transcoding, formula evaluation or automatically submitting files to external conversion services.
- A service-built download-all archive, accounts/preferences, contacts, messaging or a transfer portal.
- Uploaders previewing their local unsealed selection; that is a separate enhancement.
- Guaranteeing preview support from an extension, or instantly recalling previously issued storage URLs or downloaded bytes.
