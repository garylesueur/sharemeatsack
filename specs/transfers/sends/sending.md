---
id: transfers-sends-sending
area: Transfers / Sends
status: implemented
---

# Sending files

The inverse of a request: the agent puts files on a page and gets a link to that page. “Put them on meatsack” and “send them to Simon” are the same journey. Simon, if anyone, just gets that link. They never sign in.

## Behaviours

### B1 — Agent starts a send 🟢 implemented

An agent calls the **sharemeatsack.com** tool, or sends the same JSON over HTTP, with action `send`. It sends a title, optional message, optional expiry, optional opaque metadata, and the files it intends to put on the send — each as a name, type, and size, not as bytes. When the send is usable, it receives one short-lived upload URL per file, the sharemeatsack.com download link to give the person, a status link, and a private manage link. The tool and HTTP produce the same send.

If the payload is not usable — empty, over a limit, or missing names — create is refused and no download link is returned.

### B2 — Agent puts the bytes itself 🟢 implemented

The agent uploads each file to the URL it was given. Bytes do not go through the tool argument and do not go through this service’s compute. A URL that is close to expiry can be refreshed. Until every offered file has arrived, the download link does not serve files.

### B3 — The send is ready when the files are in and scanned 🟢 implemented

Once every offered file has arrived and has a terminal scan status, the send is `ready`. Infected files are dropped from what the person can take; the agent is told they were blocked. A send with nothing left to take after infection is cancelled rather than offered empty.

### B4 — The person downloads without an account 🟢 implemented

The person opens the download link in a browser. They see the title, any message, and each file they can take. Clicking a file downloads it. They never sign in. The page does not show the agent’s secret.

### B5 — Each file is its own download 🟢 implemented

The person takes files one at a time. There is no “download all” archive served by this product. A missing, blocked, or unknown file on that link does not reveal another send.

### B6 — The link expires 🟢 implemented

After the expiry time, the download link no longer serves files. The page explains that the link has expired. The agent’s status shows `expired`.

### B7 — Agent can cancel while the send exists 🟢 implemented

The agent can cancel a send that is still open or ready. The download link stops working immediately. Cancel when already cancelled still succeeds as gone. Cancel when already expired is refused; expired stays expired.

### B8 — The two links have different powers 🟢 implemented

The download link can only list and take that send’s accepted files. It cannot create, cancel, or read the agent’s secret. Someone without the agent token cannot wait, cancel, or refresh upload URLs.

### B9 — A broken or unknown link does not leak another send 🟢 implemented

An unknown send, or a link whose token does not match, does not show files.

### B10 — Agent can wait until the send is ready 🟢 implemented

After create, the agent may wait a bounded time for its own uploads and for scan verdicts. `ready`, `expired`, and `cancelled` are terminal for that wait. If the bound elapses first, wait returns the current status.

### B11 — The page is the thing you share 🟢 implemented

Create returns the download link immediately, even before files have finished arriving. The agent finishes the uploads, then that link *is* the send: a page of the files. If they named a person, they confirm how to reach them and put the same link where that person will see it. If they only said to put the files on meatsack, the link in this conversation is enough. Delivery is the agent’s job. This service does not send mail.

### B12 — Owner can inspect on a private manage link 🟢 implemented

Create returns a private manage link. Opening it shows title, status, expiry, the download link to share, and the file list. Fetching it as markdown returns the same summary.

## Rules (Invariants)

- A send always has a title and at least one offered file.
- Bytes never arrive in the tool or HTTP create body.
- The download link is unguessable and cannot be derived from another send’s link.
- The person never signs in.
- This service does not send mail and does not post to other chats.
- A ready send never offers an infected file.
- The agent’s secret never appears on the download page or in the download URL.
- Tool and HTTP produce the same send and the same later status.

## Decision Tables

### Whether the download link serves files

| Send state | Expiry | Outcome |
| --- | --- | --- |
| Open (uploads or scans outstanding) | In the future | Page says the files are not ready yet |
| Ready | In the future | Accepted files served |
| Ready | Passed | Refused — expired |
| Cancelled | Any | Refused — no longer available |
| Unknown or bad token | Any | Refused — not found |

### Whether a file on a ready send can be taken

| Scan status | Outcome |
| --- | --- |
| Clean | Served |
| Too large to scan | Served, marked as not scanned |
| Infected | Not listed, not served |
| Still scanning | Send is not ready |

## User Flows

- **F1 — Send files to a person:** [contract](./sending.flow.yaml) — covers B1–B12

## Open Questions

- **Settled:** Bytes go to storage from the agent, not through the tool.
- **Settled:** No zip-of-everything. Each file has its own download.
- **Settled:** The agent confirms the person, then delivers the download link itself.
- **Settled:** “Put them on meatsack” and “send them to Simon” are one send. The files go on a page. Simon only receives the link to that page. A named person is a delivery step, not a different transfer.

## Future Considerations

- The person uploading extra files onto a send (rare; a request is the right shape).
- A Meatsack portal that lists every send an account owns.
- Multipart uploads for a single file larger than the product ceiling.

## Out of Scope

- Emailing the download link.
- Asking the person who opens it to sign in.
- A “download all” archive built on this service’s compute.
- Publishing HTML or a site — that is showmeatsack.com.
