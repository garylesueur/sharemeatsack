---
id: transfers-files-moving-files
area: Transfers / Files
status: partial
---

# Moving files

The shared path both a request and a send use: files go straight to storage, this service only mints links, and the agent gets names and download URLs rather than bytes.

## Behaviours

### B1 — Bytes never transit this service 🟢 implemented

An upload goes from the browser or the agent to storage with a short-lived URL this service minted. A download goes from storage to the person or the agent the same way. Create, status, and wait never carry file bytes.

### B2 — An offered file is checked before anything transfers 🟢 implemented

A file that would break a limit is refused up front, with the reason, rather than failing part-way through. Limits are enforced here, not only in the page.

### B3 — A single file has a ceiling 🟢 implemented

No file larger than **5 GiB** is accepted. That is the product ceiling for one object, not a plan flag. A request’s own per-file cap, if set, may only be lower.

### B4 — A transfer has a count and a total 🟢 implemented

One transfer accepts at most **100 files** and at most **20 GiB** in total. A request’s own count cap, if set, may only be lower. Concurrent offers cannot collectively slip past either number.

### B5 — An upload can be retried 🟢 implemented

If a URL is close to expiry, or a put fails in a way that is worth trying again, the uploader can get a fresh URL for the same file and continue. A long transfer does not have to start over because a URL went stale.

### B6 — A file is scanned before anyone may take it 🟢 implemented

Once a file has arrived, it is checked for malware. Until that check has a verdict, status is not `complete` or `ready`, and no download URL is issued for that file.

### B7 — A clean file can be taken 🟢 implemented

A file with nothing wrong is offered. The agent’s file list includes a short-lived download URL. The person on a send sees it on the page.

### B8 — An infected file cannot be taken 🟢 implemented

A file that matches a known signature is listed to the agent as blocked, with the signature if we have it, and has no download URL. The person on a send never sees it. The object is destroyed shortly after.

### B9 — A file too large to scan is offered with a flag 🟢 implemented

A file above **500 MiB** is not scanned. It can still be taken. The agent’s list and the download page both say it was not scanned. It is never reported as clean.

### B10 — A scan that cannot finish does not unlock the file 🟢 implemented

If the check cannot be completed, the file stays blocked. The agent sees that the scan failed. The person cannot take it. A later successful check can still unlock it while the transfer is live.

### B11 — Download URLs are short-lived and refreshable 🟢 implemented

A download URL the agent is given expires in minutes, not days. Action `files` (or the matching HTTP) issues fresh URLs for the same accepted files. The agent does not fetch huge files into the conversation; it hands the URLs on, or writes small files where the client can.

### B12 — The transfer expires, then the files go 🔵 future

If the agent does not set an expiry, the transfer lasts **7 days** from create. The agent may choose a sooner expiry, never later than **30 days**. After expiry, links stop working. The stored files are destroyed shortly after. A new transfer is a new link.

### B13 — Progress is visible while a file is going in 🟢 implemented

The person uploading sees each name, size, and whether it is in flight, retrying, or done. They can remove a file that has not been sealed yet. The agent’s status during an open request does not include download URLs.

## Rules (Invariants)

- This service never holds file bytes on its compute, including for “download all”.
- Every limit is enforced here. A modified client cannot bypass any of them.
- A download URL that has expired cannot be reused. A fresh one can be minted for the same accepted file while the transfer is live.
- Infected and failed-scan files never receive a download URL.
- A skipped-too-large file is never described as clean.
- Destroying a transfer destroys its files. Another transfer’s files are not touched.
- Scan links given to the scanner live long enough for its retries. A one-hour link is not enough.

## Decision Tables

### Whether an offered file is accepted

| Count within cap | File within 5 GiB and any request cap | Total within 20 GiB | Kind allowed | Transfer still open | Outcome |
| --- | --- | --- | --- | --- | --- |
| Yes | Yes | Yes | Yes | Yes | Accepted |
| Yes | Yes | Yes | **No** | Yes | Refused — kind |
| Yes | **No** | Any | Any | Yes | Refused — too large |
| **No** | Any | Any | Any | Yes | Refused — too many |
| Yes | Yes | **No** | Any | Yes | Refused — transfer too large |
| Any | Any | Any | Any | **No** | Refused — closed |

### Whether a stored file can be downloaded

| Scan | Transfer live | Outcome |
| --- | --- | --- |
| Clean | Yes | Short-lived URL |
| Too large to scan | Yes | Short-lived URL, flagged |
| Infected | Any | No URL |
| Failed | Yes | No URL |
| Still scanning | Yes | No URL |
| Any | **No** | No URL |

## User Flows

_None._ Request and send own the journeys. This spec is the shared rules those journeys call.

## Open Questions

- **Settled:** No zip-of-everything. That convenience is what forced FileSnare’s 2 GiB send cap. Per-file links already work at the object ceiling.
- **Settled:** 5 GiB per file is the v1 ceiling (one put). Multipart, then larger objects, is later.
- **Settled:** 100 files and 20 GiB per transfer is the v1 abuse rail, not a WeTransfer ladder.
- **Settled:** Default life is 7 days, never more than 30. Large objects should not sit forever.
- **Settled:** Over 500 MiB is offered and flagged, not held. Infection is the only scan verdict that hides a file.
- **Settled:** Failed scans stay blocked. They are not treated as skipped.

## Future Considerations

- Multipart puts so one file can exceed 5 GiB.
- A store-side zip for people who want one archive, built off this service’s compute.
- A shorter default expiry when the transfer is large.
- Honest paid size ladders, if accounts and quotas arrive.

## Out of Scope

- Asking this service to email a copy of the files.
- Scanning as a public API — that is cleanroom, called only by us.
- Storing files after the transfer is gone, as a drive or locker. The meat locker is a later portal, not this product.
- Askmeatsack-style 4 MB attachments on a questionnaire.
