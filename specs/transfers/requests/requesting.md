---
id: transfers-requests-requesting
area: Transfers / Requests
status: partial
---

# Requesting files

**sharemeatsack.com** is how an agent asks a person for files. Create returns an upload link to put in the conversation, or to send from an unattended job. The person opens it, drops the files, and is done. The agent learns the result by checking status, waiting a bounded time, or being called back.

## Behaviours

### B1 — Agent starts a request 🟢 implemented

An agent calls the **sharemeatsack.com** tool, or sends the same JSON over HTTP, with action `request`. It sends a title, optional message, optional expiry, optional caps (how many files, how large each may be, which kinds), optional opaque metadata, and optionally a callback URL. When the request is usable, it always receives the sharemeatsack.com upload link (to put in the conversation, or anywhere else the agent already can post), a status link, and a private manage link. It also learns when the request will expire. The sharemeatsack.com tool and HTTP produce the same request.

If the payload is not usable, create is refused and no upload link is returned. HTTP and the tool use the same error body: `error.code`, `error.message`, and `error.issues`.

### B2 — The person uploads without an account 🟢 implemented

The person opens the upload link in a browser. They never sign in. They see the title, any message, and a place to choose or drop files. Closing the tab and opening the same link again still shows that request, until it is sealed, expired, or cancelled.

### B3 — One upload seals the request 🟢 implemented

When the person finishes sending a batch, that request stops accepting files. Opening the link again shows that they are done, not an empty drop zone. A new request is a new link. Several visits before they finish still add to the same open batch.

### B4 — Agent can wait a bounded time 🟢 implemented

The agent can wait, via the sharemeatsack.com tool or over HTTP, for up to a stated number of seconds. If the request reaches `complete`, `expired`, or `cancelled` within that time, the wait returns that result. If it is still open, the wait returns the current status — it does not hang past the bound. Someone taking ten minutes or two hours is the normal case: the agent calls `wait` again.

### B5 — Agent reads the finished file list 🟢 implemented

When status is `complete`, the agent’s status includes every accepted file: name, size, type, scan status, and a short-lived download URL. It does not include file bytes. Infected files are listed as blocked and have no download URL. The tool and HTTP return the same list.

### B6 — The link expires 🟢 implemented

After the expiry time, the person cannot add files. The page explains that the link has expired. The agent’s status shows `expired`. Files already accepted stay listed. A new request is a new link.

### B7 — Agent or person can cancel while it is open 🟢 implemented

While the request is open, the person (upload link) or the agent (status secret) can cancel it. Status becomes `cancelled`. The page says so. Cancel when already cancelled still succeeds as `cancelled`. Cancel when already complete or expired is refused; the existing terminal status is unchanged.

### B8 — The two links have different powers 🟢 implemented

The upload link can only load that request, add files to it, finish the batch, and cancel it. It cannot start a new request, open the manage page, or use the agent’s status. The upload page never shows the agent’s secret. Someone without that request’s agent token cannot check status, wait, cancel as the agent, or read the file list.

### B9 — A broken or unknown link does not leak another request 🟢 implemented

An unknown request, or a link whose token does not match, does not show a drop zone and does not accept files.

### B10 — Agent can be called back on a terminal status 🟡 partial
> Cancel and complete mark the callback as attempted. HTTP delivery of the file list is still outstanding.

When creating a request, the agent may leave a callback URL. When status becomes `complete`, `expired`, or `cancelled`, the service tells that URL the transfer id, status, and file list (same shape as status). A failed callback does not undo the status. Callbacks are not sent for unfurls or for ordinary progress.

### B11 — Ask in the conversation 🟢 implemented

Create always returns the upload link immediately. A skill shipped with this product tells the agent to confirm who the person is, call the **sharemeatsack.com** tool, put that link where they will see it, and wait. If the person is not in that conversation, the agent posts the same link itself (Slack, email, and so on). That post is the agent’s job, not this service.

### B12 — Owner can inspect on a private manage link 🟢 implemented

Create also returns a private manage link, keyed by the agent token. Opening it shows title, status, expiry, the upload link to share, and — once files have arrived — the same file list the agent sees. Fetching that path as markdown returns the same summary. The manage page never uses the upload token.

### B13 — Caps the agent set are enforced 🟢 implemented

If the agent set a maximum number of files, a maximum size, or accepted kinds, those limits are enforced when the person offers files, not after. A refused file is explained. Moving files covers the product ceilings that no request may exceed.

## Rules (Invariants)

- A request always has a title. Everything else is optional.
- The upload link is unguessable and cannot be derived from another request’s link.
- One sealed batch is the whole request. A second batch is a new request.
- The person never signs in.
- This service does not send mail and does not post to other chats.
- Status `complete` includes only files that have a terminal scan status. Infected files never receive a download URL.
- The agent’s secret never appears on the upload page, in the upload URL, or in a callback body the person could see.
- Tool and HTTP produce the same request and the same later status.

## Decision Tables

### Whether the upload link accepts files

| Request state | Expiry | Outcome |
| --- | --- | --- |
| Open | In the future or unset | Files accepted |
| Open | Passed | Refused — expired |
| Complete | Any | Refused — already finished |
| Cancelled | Any | Refused — cancelled |
| Unknown or bad token | Any | Refused — not found |

### What the agent sees on `wait` / `status`

| State | Files in the payload | Download URLs |
| --- | --- | --- |
| Open, nothing offered | None | None |
| Open, batch in progress | Not yet | None |
| Complete, file clean | Yes | Yes, short-lived |
| Complete, file too large to scan | Yes, flagged | Yes, short-lived |
| Complete, file infected | Yes, blocked | None |
| Complete, scan still running | Wait is not terminal yet | None |
| Expired or cancelled | Any already accepted, with the same scan rules | Same as complete for those files |

## User Flows

- **F1 — Get files from a person:** [contract](./requesting.flow.yaml) — covers B1–B13

## Open Questions

- **Settled:** The product is **sharemeatsack.com**. The tool is named **sharemeatsack.com**. Upload links look like `https://sharemeatsack.com/s/…`.
- **Settled:** One batch seals the request. FileSnare-style repeat visits after a finished send are a new request.
- **Settled:** Giving the upload link to the person is the calling agent’s job. This service does not email or Slack them.
- **Settled:** The agent confirms who the person is before creating, using whatever it already knows. This product has no contacts book.

## Future Considerations

- Several batches on one request, with a running total.
- A checklist of named documents (“2024 P&L”, “photo ID”) the person ticks off.
- Templates, and one request per contact in a list.
- A Meatsack portal that lists every request an account owns.

## Out of Scope

- Asking the person who opens the upload link to sign in.
- Email, Slack, or any other delivery of the link.
- Running our own sign-in. Accounts live in lanyard; creating will later need a token (see the tool spec).
- Folding this into askmeatsack.com. A questionnaire with evidence is a different product.
- FileSnare’s dashboard, contacts, reminders, or custom domains.
