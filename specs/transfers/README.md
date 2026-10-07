# Transfers

**sharemeatsack.com** — an agent moves files between itself and a person. The tool is named sharemeatsack.com. Create returns a link; the calling agent delivers it. This service does not send mail and does not post to other chats.

| Spec | Covers | Status |
| --- | --- | --- |
| [Requesting files](./requests/requesting.md) | Agent asks a person for files; one upload seals the request; agent waits and reads the list. | future |
| [Sending files](./sends/sending.md) | Agent puts files on a send; person opens a download link. | future |
| [Moving files](./files/moving-files.md) | Direct-to-storage upload, signed download URLs, limits, scan, expiry, and merging shares. Shared by request and send. | partial |
| [Viewing files](./files/viewing-files.md) | Single-file viewers, List/Grid collections, galleries, players, bounded readers and existing link powers. | implemented |

Read those three before changing how a transfer is created, uploaded, waited on, or downloaded.

Read Viewing files when changing the public send or private manage viewing experience; it adds previews without changing the transfer contracts above.
