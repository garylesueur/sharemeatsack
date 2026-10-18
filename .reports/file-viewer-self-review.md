# File viewer self-review — 6 October 2026

Review performed with the installed `calm-craft:branch-self-review` skill. Product code was read only; no whole-repository gates, commits or deployment were run by this review.

## Scope

The configured comparison is `origin/main`; the local merge base and HEAD are both `7e78131acb073aff049edf302812225027dad9ac`. This is a review of the implementation task's uncommitted work, including directly read untracked files, rather than an empty committed diff. Existing unrelated plugin, homepage, discovery, scanner and upload changes were excluded.

Reviewed shared browser/access/details/size/preview components, image and media previews, lazy Markdown/source/PDF/table renderers and their pure helpers/tests; the new read-URL service/HTTP route and tests; object read headers, R2 signing and local byte-range endpoint; public-send/private-manage callers and surrounding capability/scan/status helpers; wide transfer shell; canonical brand footer and generated copy; PDF asset regeneration, dependencies and generated-asset ignores. Also read the viewing-file specification, implementation verification evidence, engineering config and recorded conventions. The local preview boundary added during review was inspected and addresses the previously known renderer-chunk failure concern.

## Findings

### Major — transient storage failures become permanent permission loss

**Location:** `src/lib/object-store.ts:266`, used by `src/lib/transfers.ts:984` and `src/components/file-access.tsx:42`.

**Confidence: high.** The R2 `head` adapter returns `null` for every non-OK HTTP response, including final 429/500/503 after the AWS client exhausts retries. The newly added `readFileUrl` interprets `null` as missing and returns 404. The client provider treats 404 as denied, clears its cache and keeps that file in the denied set, so preview and download disappear without a recoverable Retry. A temporary R2 outage therefore looks like permanent permission loss for the open page.

A focused read-only Node check replaced `fetch` with a 503 response: the real adapter received four 503s and returned `null`. No network request or test artifact was required. Genuine 404 should remain missing; non-404 storage failures should propagate as service unavailability so the existing route catches them as 503 and the client retains Retry. Protect the distinction at the adapter/route boundary.

### Minor — missing selected item skips the nearest surviving focus target

**Location:** `src/components/file-browser.tsx:57`.

**Confidence: high.** When the selected item disappears, focus restoration tries only its old element and then the collection heading. B5 expressly promises the nearest surviving item before the heading. Keep enough prior position/order information to select a surviving neighbor, and use the heading only when none remain. Current Back/Forward checks cover the ordinary retained-item case but do not establish this missing-item behavior.

### Minor — mobile collection stage covers the transfer context

**Location:** `src/components/file-browser.tsx:136`; public/private page callers render their title/message outside the stage.

**Confidence: high.** Below the `sm` breakpoint, the selected collection stage is fixed with an opaque full-viewport background. Transfer title/message sit outside this stage, and the browser receives only files, so neither remains visible while browsing an opened mobile collection. B6 says the title/message remain visible. Pass that context into the mobile stage, or explicitly decide and update the intended mobile contract. Filename and scan/download details remain present.

## Checked conclusions and limits

- No verified capability bypass, public request receipt exposure or scan bypass was found. Read service scope is transfer/file/capability bound; public issuance stops after expiry/cancellation, private accepted retained reads follow the existing terminal-state contract, and missing objects receive no newly issued URL.
- Preview and original download remain distinct purpose grants. Local GET/HEAD are grant bound; production R2 disables that local endpoint. Local ranges and response headers have meaningful tests. The pre-existing local development PUT path was outside this implementation's authorization changes.
- Markdown raw HTML is disabled, links are checked before rendering, outbound links suppress referrers, same-transfer attachments require exact unique permitted filenames, cells remain React text, and SVG is loaded through an image element rather than injected into the DOM. PDF renders bounded canvases without annotation/forms/XFA execution and uses local worker assets.
- Byte, text-line, table-row/column/cell, PDF page/raster and image limits are explicit. Native media does not allocate a whole-original buffer; selection cleanup stops media and aborts/revokes renderer resources. PDF render work is serialised and cancelled. No further confirmed lifecycle/security defect survived surrounding-code review.
- The new local preview error boundary preserves navigation and original download if a renderer chunk throws. Its browser failure check remains the implementation owner's verification responsibility.
- Review reused recorded Chrome desktop/mobile viewport and real R2 video/range/PDF evidence; it did not independently exercise physical Safari/Firefox, new production read-route deployment or all release gates. Those must remain honestly scoped in the final implementation report.

At review handoff: **0 Critical, 1 Major, 2 Minor** confirmed findings. The implementation owner owns fixes and final validation; this report records the code reviewed before those fixes.

## Resolution recheck

Read-only follow-up inspected the implementation owner's fixes:

- **Transient R2 denial: resolved.** HEAD now returns null only for HTTP 404 and throws for non-404 failures or invalid metadata. The route's existing exception handler returns retryable 503. Inspected added adapter missing-versus-outage coverage and route outage-then-success coverage; the implementation owner reports 13 affected tests passing. This reviewer did not rerun those tests.
- **Nearest surviving focus: resolved.** The browser stores the previous item's ID and index, tries the item itself, then the surviving item at the bounded previous position, then the heading.
- **Mobile transfer context: resolved.** Both public/private callers supply title/message, which the mobile selected collection stage renders inside its surface.
- **Local renderer boundary: present.** Failure is isolated below details/download and navigation; explicit Retry reloads the current URL.

The newly added `useOverlaySurface` was also inspected. Nested mobile collection/expanded-image ownership needs a focused Browser Back-while-expanded check: both instances snapshot some of the same siblings and body overflow, so non-LIFO subtree cleanup can restore stale inert/overflow values. This was sent to the implementation owner as a verification concern, pending browser confirmation; it is not yet counted as a confirmed finding in this report.

### Major follow-up — nested overlay cleanup can lock the next page

**Location:** `src/components/overlay-surface.ts:42` (body snapshot) and `:50` (snapshot restoration).

**Confidence: high.** Mobile collection and expanded image each acquire the same body scroll lock and some of the same outside siblings. The inner instance captures `overflow=hidden` and `inert=true` from the outer instance. Removing the complete transfer subtree restores parent effects before child effects, so the child re-applies those stale captured values after the outer instance has released them. The next page may remain scroll locked and outside siblings remain inert. Ordinary Back-to-collection can appear fine because the FileBrowser survives that transition; whole-route removal exposes the defect.

Verified the installed React 19 deletion traversal at `node_modules/react-dom/cjs/react-dom-client.development.js:16248`: passive unmount effects run before descending into child fibers. A focused read-only Node check ran the actual hook source against minimal DOM/effect objects with outer/inner acquisition and parent/child cleanup. After both cleanups, body overflow was still `hidden` and the footer/outside information remained `inert=true`. No product files or test artifacts were created. Use shared/reference-counted ownership for element inertness and body overflow, retaining the original base state until the last owner releases it, regardless of cleanup order.

Current follow-up count: the three original findings are resolved; **one new Major** remains for nested overlay ownership. Implementation owner informed promptly.

## Final overlay resolution recheck

**Nested overlay ownership: resolved.** Read the new `src/lib/overlay-ownership.ts`, its two cleanup-order regression tests, and the updated `src/components/overlay-surface.ts`. The hook now acquires a shared per-body ownership manager. Each outside element retains its original inert value until its last owner releases it; body overflow likewise restores only after the last overlay releases its lock. Releases are idempotent, and repeated elements are deduplicated. Parent-first and child-first cleanup therefore restore the same base state without reapplying an inner overlay's temporary snapshot.

The implementation owner reports browser verification of mobile expanded-image route Back leaving body overflow empty and inert count zero, plus Escape restoring focus to Expand and then to the opened collection item. This reviewer inspected the corresponding ownership logic and regression tests without rerunning broad gates or editing product code.

**All confirmed review findings are resolved. Outstanding confirmed findings: 0 Critical, 0 Major, 0 Minor.** Physical Safari/Firefox and new production deployment remain outside this review's verification claims, as previously recorded.
