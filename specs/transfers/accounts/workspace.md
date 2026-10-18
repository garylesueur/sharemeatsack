---
id: transfers-accounts-workspace
area: Transfers / Accounts
status: implemented
---

# Your files, transfers and activity

After signing in through Lanyard, a person has a small personal file library and can
find outgoing sends, file requests, and incoming items they have saved. This extends
[requesting](../requests/requesting.md), [sending](../sends/sending.md) and
[moving files](../files/moving-files.md).

This workspace is the Share area of the single Meatsack portal at https://meatsack.puregaz.com.
The shared product switcher opens Ask or Show without another sign-in; public upload
and download links keep their existing sharemeatsack.com addresses.
Signing in from sharemeatsack.com opens My files in this portal using the same account
and browser session as Ask and Show. The shared portal contract in lanyard governs
entry destinations, switching and account controls; this spec governs Share's records.

## Confirmed personal-account policy

The starter allowance is 1 GB of retained file storage per account in this product.
Own uploads remain until owner deletion within that allowance. Another person's
uploads received through a request have a 90-day default retention period. Keeping
an eligible received file as an independent My files copy is explicit and consumes
the owner's allowance; saving an incoming reference alone does not keep the bytes.
Recent product activity is retained for 90 days independently of content lifetime
and public-link expiry. These decisions were submitted on 2026-10-07; enforcement
and visible allowance/retention controls for files and outgoing transfers are
implemented and verified in Development. Incoming saves and eligible independent
recipient copies are also verified in Development. Historical private-proof claims and
Activity are verified in Development. Production deployment remains separate work.

## Behaviours

### B1 — Your files have a home 🟢 implemented

**Local implementation:** Convex metadata reserves the decimal 1 GB allowance
atomically, including unfinished uploads and removal tombstones. The Share service
uses existing storage and scanning adapters; uploads go directly to a staging key,
then storage copies bytes into a separate sealed key for scanning and reading.
R2 library upload capabilities bind the reserved size and offered content type;
storage rejects a different size or type before accepting the PUT.
Only verified owner authority can list/search, open, retry, remove or request a
temporary preview/download URL. Failed scans remain blocked. Removal hides only
the chosen file, preserves referenced bytes, and releases space only after upload
capability expiry and confirmed storage deletion. Local durable scheduled cleanup,
retries and bounded recovery now cover account deletion without a returning owner.
The signed storage worker also requires the current metadata cleanup authorization.
A real R2 copy/removal race refuses the late scan transition and keeps both storage
keys tracked while the copy finishes. Its scheduled retry confirmed both objects
absent before releasing the reservation.
After confirmed deletion, minimal durable storage cleanup records continue to
recover late writes without retaining account identity, filenames or available
library content. Removed storage identities cannot be reused by a new upload.

The shared portal provides a remembered Grid/List view, actual server search,
upload progress/retry, private detail and a removal confirmation. Text previews
are inert and bounded to 64 KiB; media uses native browser rendering. Empty,
loading, unavailable, missing and blocked states are distinct. Local tests cover
quota races, account isolation, sealed-byte immutability, scanner receipts,
retry and selected-file removal. Focused cleanup tests additionally cover persisted
jobs, missing configuration followed by recovery, storage failures, fair recovery,
guarded deletion and idempotent event capture.
The Activity view and 90-day expiry enforcement remain B5. The UI was checked on
desktop and mobile using explicitly labelled isolated sample records. Subsequent
real Development checks confirmed direct upload and scan, exact browser download,
restart persistence, removal preserving another file and delayed scheduled storage
release without a returning portal visit. A genuine second account cannot list,
read or remove the first account's retained file. Real account deletion removes
its authentication records and hides its file while the reservation waits for
safe storage cleanup. A real due callback outage preserved that reservation and
persisted a retry. After the callback was restored, the scheduled retry removed
both actual R2 objects and the file row, released quota to zero and retained only
the minimal storage watch, without the deleted owner returning.
Activated recovery processed 25 isolated legacy tombstones
then the remaining one in the next batch, refused referenced deletion/release,
and completed cleanup after their dummy references were cleared. R2 confirms all
26 fixture staging keys absent; genuine retained files were unchanged. Natural
cancelled-job recovery completed with one active retry chain. Exact-allowance
metadata fixtures also completed scheduled cleanup: both hidden rows are absent,
usage returned to 2 bytes and the genuine retained file remains visible. The actual
provider copy/removal race also completed scheduled cleanup after a persisted retry:
the row and both actual R2 objects are absent, and its minimal watch is retained.
Final stored-watch read-back confirms the three completed quota/race watches have
only approved fields, zero attempts and distinct pending future jobs. The temporary
Development callback resource was restored to its original absent state before
task proxy/tunnel teardown. The central Development configuration save and normal-reader
validation now pass. This is the verified Development checkpoint; deployment remains separate.

"My files" lists the account's retained files and supports upload, search, preview,
download and removal. Each file shows its name, size, availability and scan status.
The storage allowance and retention are stated before relying on the library.
Uploading to the library does not publish a download link automatically.
The My files content area accepts dropped files in Grid and List, alongside the
labelled Upload files picker. Multiple selected files upload in sequence; a failed
upload pauses its batch, retaining that file's reservation and the files not yet
started. Retry resumes the same reservation before continuing. Directory drops are
refused with an explanation rather than importing a placeholder or only part of the
selection. This does not add folder organisation to the library.
Retrying after a lost upload-offer response continues the same file reservation,
without charging twice or extending its original upload deadline. A sealed,
expired or removed upload cannot be reopened by repeating its offer.
Files uploaded by the account holder, or their authorised agent on their behalf,
remain until owner deletion within the stated allowance. Files uploaded by another
person through a request have a time-limited default instead. Saving an incoming
reference does not silently turn someone else's upload into permanent library content.

### B2 — Sends and requests are distinct 🟢 implemented

> Sent/Requests portal views and new owned durable transfer authority are implemented
> and verified in Development under plan B2. Real library-send, recipient download,
> received progress, scanning, public expiry and owner retention checks pass.
> Selected account deletion, actual callback failure/retry, confirmed storage release
> and minimal cleanup watches pass. Production release and historical Redis migration
> remain separate.

The signed-in product area has separate views for sent files and requests for files.
Each transfer shows title, kind, creation time, expiry, current state and relevant
file or progress counts. The owner can open its existing manage view and use permitted
actions without recovering a private manage link from the original conversation.

Where the existing private-key merge action is used, both owned transfers must
belong to this same account. Two durably retained transfers use the retained-file
rules. Two same-account legacy-owned transfers continue under their existing
legacy rules, without migration or new durable retention guarantees. Different
owners, an owned/anonymous pair and mixed durable/legacy transfers are refused as
a conflict: neither record, file reference nor account allowance changes. Existing
merges between two anonymous legacy transfers continue under
[Moving files B14](../files/moving-files.md).

### B3 — Your agents' work appears automatically 🟢 implemented

> Verified attribution, owner APIs, durable new owned transfer history and independent
> keeping are implemented in Development. Exact-byte real copies, 90-day source
> deadlines, retry accounting, cross-account refusals and long-boundary controlled
> checks pass. Actual selected account cleanup retained reservations through a worker
> outage and the original upload deadline, then released them after confirmed R2
> absence. Protected account files remained available; temporary callbacks were
> restored and removed. Production release remains separate.

A transfer created with verified authority for the account is listed automatically.
Files received through the account's own requests are discoverable with that request
and can be kept in My files under the library's stated rules.

Keeping is available only while the owner can still read an accepted received file:
the bytes must still exist within their retention period, and the scan must be clean
or explicitly marked too large to scan. Pending, infected and failed scans cannot be
kept. The same conditions are checked again before the independent copy becomes
available. Public request-link expiry alone does not remove permitted owner access
to still-retained accepted files. The 90-day received-file retention does.

Reopening or refreshing the request reads its available independent kept-copy
association from authoritative metadata. An existing copy shows Kept in My files
and Open kept file instead of another creation-and-charge confirmation. Failed,
hidden, removing, removed or foreign copies are not presented as available; loss
of the original source's retention does not hide a still-available independent copy.

The kept file records the source request and received-file identity, who supplied
the original when that fact is known, and when it was received and kept. It retains
the source's truthful scan status and any warning that it was not scanned. Keeping
does not claim that another person's upload was originally the owner's upload.
The confirmation states the copy's size and allowance cost. Retrying the same
keeping action finds or finishes its one copy; it does not reserve storage or
record successful keeping again. A later source expiry or deletion cannot remove
a successfully committed independent copy.

An allowed same-account durable merge preserves each received file's original provenance,
received time, scan warning and retention deadline. It does not restart the 90-day
period, charge the bytes again, or turn another person's upload into an indefinite
own upload. A previously kept independent My files copy stays independent after
the source transfers merge.

**Implemented foundation:** HTTP and MCP creation with verified Lanyard authority
attaches an immutable account reference. Anonymous creation remains available when
Authorization is absent; supplied invalid authority cannot fall back to anonymous.
Owner-indexed APIs list bounded summaries, open owned details and cancel under the
existing lifecycle rules. Details exclude private management proofs and supply file
reads only when the existing scan and availability rules permit them. Other accounts
cannot retrieve or cancel an owned record. New owned transfers use Convex metadata
independent of the old Redis terminal read window. Public expiry remains enforced;
received source uploads keep their 90-day deadline. Explicit keeping creates an
independent library copy and does not extend the original source's retention.
Existing anonymous and legacy-owned records retain their prior rules until a
separately reviewed claim or migration.

### B4 — Incoming items can be saved explicitly 🟢 implemented

> C2 is implemented and verified against Development Convex and real R2: explicit saves, recipient roles, sign-in/account-change confirmation, private copies, quota/scan guards and durable cleanup retry pass. Synthetic disposal restores protected storage baselines and temporary callbacks are restored. Activity and hosted release remain separate.

A person opening a send or upload request can choose Save to my account. The portal's
Incoming view identifies the current signed-in account, the transfer and the role
before an explicit Save. Sign-in or opening Incoming never saves automatically.
An incoming send means files shared with the person; an incoming request means files
they were asked to supply. Saving creates one private account reference, stores no
file bytes and consumes no file-storage allowance. Repeating a successful Save or
retrying an uncertain response finds the same reference and records success once.

The public entry uses the fixed Lanyard destination
`/save/sharemeatsack#url=<encoded-canonical-public-URL>`. Only the canonical
sharemeatsack.com recipient URL and its public token are accepted; manage proofs,
temporary storage URLs, viewer parameters and arbitrary redirect destinations are
refused. The landing immediately removes the fragment from the displayed address.
The continuation keeps at most one pending intent in this tab's sessionStorage for
15 minutes. Sign-in uses the existing `product=sharemeatsack&section=incoming`
destination; the public URL/token never enters authentication or redirect query
parameters, cookies or activity payloads. After sign-in, Incoming recovers the valid
intent and asks for Save to the account currently shown. Changing accounts requires
a fresh confirmation; private results or a submitted action are never reused for
another account.

If tab storage is blocked or fails, the entry explains that automatic continuation
is unavailable and leaves the public URL selectable, with a paste action in Incoming
after sign-in. A missing, expired or invalid intent similarly offers paste recovery.
Cancelling clears the pending intent without saving. A service failure retains the
choice for Retry within its original deadline; it never silently reports success.
If access ends during sign-in or before Save commits, Incoming shows unavailable and
does not create a new reference. An already-saved reference remains discoverable with
its unavailable reason when public access later ends; this does not reopen the source.

Incoming uses account-scoped saved-reference IDs for private detail routes. Possessing
such an ID does not authorize reading or changing that row. Another account cannot
list, open or act on it, and the row never exposes the sender's private manage view.
A saved public link grants exactly its existing recipient powers. A send permits
only currently eligible recipient reads/downloads. An upload request permits only
the existing upload journey; it cannot reveal or keep another person's received
files or inspect the request owner's receipt. Saving never changes ownership,
claims a transfer, extends source retention or reopens expired or revoked access.

From a saved incoming send, Keep in My files is a separate explicit file action.
It is offered only for a newer account-backed durable send whose original public
link still grants download access to that same file: bytes must exist, source
retention must remain valid, and the scan
must be clean or truthfully marked too large to scan. Pending, infected and failed
scans are blocked. The confirmation states the independent copy's size, storage cost,
provenance and any scan warning. The account's decimal 1 GB allowance is checked and
reserved atomically. Saving remains possible at full allowance, but keeping cannot
exceed it; exact-boundary, competing-action and retry behavior follows the existing
library lifecycle. No ownership of the source transfer is inferred from copying.

Keeping reuses B3's independent-copy lifecycle and B1's storage cleanup guarantees.
The source must support authoritative commit-time access checks. Existing legacy
links may be saved and opened under their existing recipient rules, but keeping
their bytes is unavailable with the visible reason `legacy_source`. C2 does not
migrate those records or change their existing lifecycle. Account authority, public recipient
access, source file identity, retention and scan eligibility are checked again before
commit. Losing any requirement before commit
leaves no available copy, even if bytes have finished copying. Unfinished bytes stay
private and their reservation remains held until safe deletion is confirmed; cleanup
continues without a returning account. Retry reconciles the same keeping action and
avoids duplicate copies, charges or successful outcomes. Cancelling an unfinished
keep safely cleans it up; an uncertain result that already committed is shown as kept
rather than silently removed. Leaving alone does not cancel an accepted copy.

A successfully committed copy remains independently readable in that account's My
files after the original expires, is revoked or is deleted, until the owner removes
the copy under B1. The original incoming reference still reports unavailable.
Reopening Incoming finds the authoritative available kept-copy association rather
than offering another creation and charge. Hidden, removing, removed or foreign copies
are not presented as available. Actual committed save/keep outcomes may be recorded
for B5/C4 without including recipient tokens or implying delivery; activity UI is
outside C2. Keyboard, narrow layouts, loading, empty, error, unavailable and success
states preserve the portal's navigation and recovery controls.

### B5 — Recent activity explains what happened 🟢 implemented

**Development checkpoint (2026-10-12):** C4's real library upload/scan/send,
incoming Save/Keep and received-request completion/cancellation checks pass without
duplicate terminal history. Owner-scoped reads and safe destinations, exact 90-day
expiry/purge and account closure are verified. All synthetic reserved bytes are
released; temporary callbacks are restored. Evidence: Show's
`.reports/portal-c4-verification.md`. Hosted release remains separate.

The account sees recorded uploads, scan results, sends created, requests created,
received batches, cancellations, expiries and explicit sharing actions, with times
and links to the relevant item. Failed or blocked files remain understandable.
Copying a link is labelled as copying it, not delivering it to a named person.

The shared [portal activity contract](/Users/gaz/dev/_garylesueur/lanyard/specs/identity/accounts/portal.md#recent-activity-retention-and-observation-contract) governs read boundaries, item targets, replay, late callbacks and account cleanup.

### B6 — Files and live links are easy to share 🟢 implemented

The owner can create a send from eligible library files, then use a clearly visible
Share action to copy the public link or open the available device/email sharing route.
Recipients can forward a live public send from its viewing page using the same controls.
The action explains that anyone receiving this link can access its available files.
It never shares the private manage link or a temporary storage URL.

Recipient sharing uses the canonical public send URL with its required public
token, without viewer filters, selected-file state or private parameters. Copy
success is reported only after the clipboard confirms it. Unsupported or failed
copying provides a selectable usable link and Retry. Device sharing distinguishes
completion, cancellation and failure; an email route requests an email-app handoff
without claiming a draft opened or a message was sent. Expired, cancelled, pending
and invalid sends explain why sharing is unavailable and never regain access from
the sharing control. Public actions provide local feedback only: they cannot write
private owner activity or identify or track recipients.

### B7 — The next person can use sharemeatsack.com 🟢 implemented

Public transfer and completion pages provide a small route to send files or request
files using sharemeatsack.com. Existing upload and download actions remain usable
without an account. Expired, cancelled or otherwise unavailable transfers show why
their sharing action is unavailable.

The entry leads to the product's install guide for the person's existing agent;
it does not require sign-in to finish the original transfer or start another
browser upload form on that transfer's behalf.

### B8 — Older transfers can be claimed with private proof 🟢 implemented

**Development checkpoint (2026-10-12):** Private-proof claims, account separation, original expiry/content retention and explicit portal review/confirmation are verified. Temporary callbacks and disposable test content are cleaned up. Hosted release remains separate.

A signed-in person can claim a surviving unowned send or request using its valid
private manage secret. It appears in the appropriate account view. A public upload
or download link cannot establish ownership. Already-owned transfers cannot be taken
from another account, and claiming does not reset expiry or recover deleted files.

## Rules (Invariants)

- Account authority is checked for library, outgoing-transfer and activity access.
- The signed-in management UI lives in the shared portal and uses its existing
  Lanyard session, product switcher and account settings.
- A public transfer link grants only that transfer's existing recipient powers.
- Incoming items are explicitly saved; recipient names or emails in prose never
  automatically grant access or link a transfer to someone else's account.
- Library retention and public link expiry are separate and explained separately.
- Retention distinguishes the account holder's own uploads from other people's
  uploads. Attaching another person's file to an owned request does not make it an
  indefinite personal upload by default.
- Saving an incoming reference does not preserve access after the sender revokes it.
- Saving or keeping an incoming item never transfers source ownership or adds recipient
  powers. An upload-role reference never grants access to another person's receipt.
- Incoming references and kept-copy associations are checked against the current account;
  saved-row IDs are route identifiers, not private management proof.
- A save continuation is confined to one tab and its original 15-minute deadline.
  Its public token is absent from authentication/redirect queries, cookies and activity.
  Sign-in, account changes and reopening Incoming cannot commit an automatic Save.
- Creating a new send never changes the source request's permissions or reopens it.
- Existing direct-to-R2 upload/download and cleanroom scan rules apply to library files.
- Blocked files cannot be shared; files too large to scan retain their existing warning.
- Sharing is an action by the person; choosing a route does not send anything automatically.
- Current transfer expiry/deletion cannot silently destroy a separately retained library
  file, nor can library retention silently extend a public link.
- A send created from My files references eligible retained files without a second
  byte charge. Establishing the send and protecting those file references is one
  decision; removal cannot gain a new reference after it has begun.
- A copy is available only after both complete independent storage and current
  permission to keep the source have been confirmed. Losing source authority during
  copying cannot be bypassed by an earlier eligibility check.
- Unfinished or refused copies remain hidden. Their storage allowance stays held
  until outstanding writes cannot restore them and safe removal is confirmed;
  cleanup continues without the person returning to the portal.
- Owned merges require the same owner and matching durable or legacy lifecycles.
  A cross-account, owned/anonymous or mixed durable/legacy merge changes neither
  transfer, its file references nor any storage allowance. A permitted legacy
  merge does not migrate its records or grant durable retention guarantees.

## Decision Tables

| Item | What the account can do |
| --- | --- |
| Own eligible library file | Preview, download, remove, create a send |
| Own outgoing transfer | Inspect and use its permitted management actions |
| Another person's newer durable public send, explicitly saved | Read/download only while the recipient link permits it; keep an eligible independent copy explicitly |
| Existing legacy public send, explicitly saved | Existing recipient reads only while available; keeping unavailable with legacy_source reason |
| Another person's upload request, explicitly saved | Supply files under the existing request rules; no receipt browsing or keeping others' uploads |
| Unowned surviving transfer with valid private management proof | Claim into the account; preserve its existing expiry |
| Incoming link expired or revoked | See unavailable status; no access bypass |
| Blocked or failed-scan file | See reason; no download or send |
| Full file allowance and available incoming link | Save the reference without byte charge; refuse a keep that would exceed allowance |
| Incoming source lost before save/copy commit | Refuse a new save or available copy; safely clean unfinished copy storage |
| Source lost after an independent copy commits | Original reference is unavailable; the account's retained copy remains readable |
| Saved-row ID belonging to another account | Refuse private list/detail/actions without revealing the row or copy |
| Sign-in return with valid one-tab intent | Show current account and role; wait for explicit Save |
| Missing/expired intent or blocked tab storage | Explain recovery and offer paste; never autosave |

## User Flows

- **F5 — Claim surviving anonymous work:** [contract](./workspace-claim.flow.yaml) · [diagram](./workspace-claim.flow.mmd) — covers B8.

- **F1 — Send files from My files:** [contract](./workspace.flow.yaml) ·
  [diagram](./workspace.flow.mmd) — covers B1, B2 and B6, including changed eligibility,
  uncertain creation, retry, sharing and cancellation.
- **F2 — Keep a received file in My files:** [contract](./workspace.flow.yaml) ·
  [diagram](./workspace.flow.mmd) — covers B1–B3, including allowance refusal,
  source loss during copying, idempotent retries and safe cleanup.
- **F3 — Share a public send or discover the product:** [contract](./workspace.flow.yaml) ·
  [diagram](./workspace.flow.mmd) — covers B6–B7, including public availability,
  supported sharing routes, cancellation, failure and manual-copy recovery.
- **F4 — Save an incoming transfer and keep an eligible file:** [contract](./workspace.flow.yaml) ·
  [diagram](./workspace.flow.mmd) — covers B1/B4, including one-tab sign-in continuation,
  explicit account confirmation, role restrictions, unavailable references, source loss,
  allowance refusal, independent copies, cancellation and idempotent recovery.

## Open Questions

- **Settled:** C2 focuses on newer account-backed Convex transfers. Existing legacy
  links can be saved/opened under their existing rules; permanent keeping is unavailable
  with a visible `legacy_source` reason. Existing records and test fixtures retain
  their lifecycle; migration or cleanup is not a prerequisite or part of this chunk.
- **Settled:** One portal hosts all three product workspaces with a persistent switcher.
- **Settled:** Own uploads stay until owner deletion within a storage allowance;
  other people's uploads have a time-limited default, separate from public-link expiry.
- **Settled:** Incoming sends and requests use explicit Save to my account first;
  automatic account-addressed delivery is deferred.
- **Settled:** C2 uses a fixed fragment-based portal landing and a 15-minute one-tab
  save intent; sign-in returns to Incoming for a separate current-account Save.
  Storage failure has selectable-link/paste recovery, with no authentication token forwarding.
- **Settled:** Surviving older transfers can be claimed with private management proof
  (B8); public links and supplied metadata are insufficient.
- **Settled:** Starter retained file storage is 1 GB per account; other people's
  request uploads have a 90-day default. Explicit eligible independent copies use
  the owner's library allowance and never happen automatically.
- **Settled:** Recent activity is retained for 90 days independently of retained
  content. Retained owned transfers follow the owner-content policy; expiry still
  stops public access.

## Future Considerations

- Folders, bulk actions and a combined activity view across products.
- Named account-to-account delivery, rather than explicitly saving an incoming link.

## Out of Scope

- R2 replacement, file-byte migration or changes to cleanroom.
- Legacy-source keeping, historical migration and cleanup of existing test records.
- Contacts, automatic messages, reminders or outside-message delivery receipts.
- Desktop file synchronisation.
