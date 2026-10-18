# sharemeatsack.com file viewer — proposed UX

Status: design proposal; application code and live deployment unchanged.

## Purpose and scope

Let a person recognise, view, play, read, and download a shared file without leaving the transfer unnecessarily. Preserve the existing meatsack identity and let the content occupy the page.

Scope assumption pending the optional question: use the same viewer on public send pages and private manage pages for received requests. The public upload link retains its upload/confirmation permissions; opening it does not grant access to the private received-file viewer. Local previews of the uploader's own selected files are a separate enhancement.

The existing specs govern direct-to-storage transfers, scanning, expiry, and the different powers of upload and manage links. Previewing is an addition to those contracts. This proposal is not an authoritative feature spec yet.

## Core viewing model

- One file: open its natural viewer immediately. Keep filename, human-readable size, scan state, and Download original alongside it. Hide collection controls.
- Multiple files: provide List and Grid views. Media collections start in Grid; document and mixed collections start in List. Preserve the user's selection when switching views.
- Grid shows an image or a video poster when available, otherwise a recognisable type icon. Each item keeps its filename and size visible.
- Opening an item enters the same viewer used for a single file. Collections add Back to files, previous/next, and an item count. Closing restores the collection's scroll position, selection, and filters.
- A carousel is navigation inside an opened media collection. The grid gives an overview; the carousel lets the person move between items without closing the viewer.
- Default order is the sender's offered/upload order. Name sorting and filename search help with larger batches, which can currently contain up to 100 files.
- Files with different types remain visible in one collection. Filters may narrow it, but an image gallery must not hide documents that belong to the transfer.

## Behaviour by file type and count

| File family | One item | Several items |
| --- | --- | --- |
| JPEG, PNG, WebP, AVIF and other supported still images | Large image fitted without cropping; zoom, pan, fullscreen and Download original | Thumbnail gallery; open a lightbox with previous/next, filmstrip and an item count; List remains available |
| Animated GIF / animated WebP | Animation preview with a clear animation label; reduced-motion handling where feasible | Still thumbnails or type tiles until opened; only the selected item animates |
| Supported video files | A prominent player with Play, timeline, volume and fullscreen; no autoplay | Poster/icon grid; opening a tile shows one player, with previous/next and a filmstrip; leaving a video pauses it |
| Supported audio files | Compact audio player with timeline, duration when known and volume | Playlist/list, with one active track; choosing another stops the previous track |
| Markdown | Formatted reading view with headings, lists, tables, links and code blocks; source toggle and original download | Filename list or type tiles; selected document opens in the reader with previous/next |
| Plain text and logs | Readable text view; line numbers where useful; clearly marked partial preview for large files | File list with the same selected-file reader; no simultaneous rendering of every file |
| Code, JSON, YAML, XML and configuration | Syntax-highlighted source when recognised, plain text otherwise; Copy and Download original; code is not executed | Filename/type list with a selected source viewer |
| PDF | Document viewer with page count and navigation; zoom and download; a fallback when preview is unavailable | Document tiles/list; opening one enters the PDF viewer; switching documents is distinct from changing pages |
| CSV / TSV | Table preview with column headers, horizontal scrolling and a bounded first set of rows | Table-file list; one selected table at a time |
| Excel / other spreadsheet workbooks | Initially a clear spreadsheet tile and download; later a read-only table preview with sheet tabs | Workbook list; open one workbook, then choose a sheet; do not combine separate workbooks |
| Word / rich-text documents | Initially a document tile and download; later a read-only document preview with an honest formatting limitation | Document list/grid with the same viewer and per-file downloads |
| PowerPoint / slide files | Initially a presentation tile and download; later slide thumbnails and a slide viewer | Presentation list; select a deck, then navigate its slides; deck navigation and slide navigation stay separate |
| ZIP, TAR and other archives | Archive tile with name and size; download; a later enhancement may show the archive's contents | Archive list/grid; selecting an archive never silently expands its contents into the transfer |
| SVG, HEIC, RAW, TIFF, PSD and other specialist visual formats | Use a safe, supported image preview where available; otherwise a type tile and a clear preview-unavailable explanation | Keep them in the visual collection, using a placeholder/type icon when no thumbnail exists |
| HTML and other active documents | Source preview or download; do not turn a shared file into executable same-origin page content | File list with source viewer or download. Publishing a live HTML page remains showmeatsack.com's job |
| Fonts, CAD, 3D assets, installers and unknown binary formats | File/type icon, full filename, size, scan state and a primary Download original action | List/grid with reliable type icons and individual downloads; no misleading preview shell |
| Mixed batch: images, videos, Markdown, documents, etc. | Not applicable | List by default, Grid available; open any item in its appropriate viewer; optional type filters and previous/next across the current filtered set |

Playback depends on the codec and browser, not only the filename extension. An MP4 or MOV is not a promise of playback. A failed preview must retain the file details and download action, with a clear message.

## Layout and spacing

The current working transfer body uses max-w-xl, while the site shell is wider. Give the file viewer the wider shell; constrain Markdown/text reading width inside that shell rather than constraining the whole media stage.

Single media file:

1. Transfer title and optional sender message.
2. Filename, readable size, scan state and Download original.
3. The image/player/document as the main content.
4. A quiet expiry note and the existing site footer.

Collection:

1. Transfer title/message, file count and total size.
2. List/Grid control, with search/sort only when useful.
3. Rows or thumbnail tiles.
4. A selected-file viewer with collection navigation and the current item's download action.

Make file names wrap independently of buttons. Use a dedicated secondary metadata line rather than one string of filename, bytes, status, and Download. Show 460.3 MiB rather than 482663402 bytes. Keep action labels and hit areas comfortably separated, and give keyboard focus a clear outline.

On mobile, the player/reader fills the available width, collection tiles adapt to the screen, and the opened viewer becomes a full-screen surface with a visible close/back control. Keep downloads and filenames accessible without horizontal page scrolling.

Group footer links so they wrap deliberately, with adequate row spacing and padded click areas. The footer is generated from meatsack-brand; any spacing change must be made to its canonical components/site-chrome.tsx and regenerated into the product through the owning workflow.

## Shared states and constraints

- Empty, uploading, scanning, ready, complete, cancelled and expired keep the existing transfer rules and appropriate copy.
- Scanning files receive no preview or download URL until the scan rules permit access. Infected or failed-scan files remain blocked.
- A file over 500 MiB remains available with Not scanned — too large visible beside its details. It is never called clean.
- Loading an image, document or media player has a bounded loading state; preview errors offer retry where useful and the original download when allowed.
- Expired signed URLs refresh while the transfer remains live. Preserve playback time, reading position and selection where possible. An expired or cancelled transfer must not mint new access.
- Download original remains available in every supported viewer when the file is takeable. No service-built download-all archive is added.
- Large videos use media streaming/byte ranges; opening a collection must not download all its videos to build thumbnails. Use a type icon until a cheap poster is available.
- Text/Markdown/table previews are bounded, with a clear truncation message and original download for the complete content. Exact preview limits belong in the implementation spec.
- Markdown is rendered without executable raw HTML. Links and embedded media use safe protocols. References to another file in the same batch can be resolved only when that attachment is authorised for the viewer; an absent asset gets a helpful placeholder.
- No conversion service receives private files as an incidental consequence of opening the page. Office and specialist-format previews need a separately designed conversion/renderer path.
- Keyboard: focusable items, Enter to open, Escape to close, appropriate previous/next keys, focus returned to the opened item. Media controls retain their expected keyboard behaviour. Touch and swipe complement visible buttons.
- The selected file, view and navigation state should work with browser Back/Forward and survive refresh where feasible, without exposing the private manage token on public pages.

## Suggested delivery order

1. Fix file-row and footer spacing. Introduce one collection/viewer component shared by the send and private manage surfaces, with List/Grid, individual downloads and all fallback states.
2. Add single/multiple image and video experiences, audio, Markdown and plain/source text. Verify the supplied video can start, seek and recover expired URLs without fetching the entire collection.
3. Add PDF and bounded CSV/TSV reading.
4. Add richer Office, archive and specialist previews when their rendering cost and privacy model are defined.

Use fixtures for one file, two files and a large collection; include long filenames, mixed types, unsupported codecs, preview failure, mobile layout, keyboard navigation, skipped-too-large and expiry. Retain scan and token-boundary coverage at the service layer.

## Evidence and references

- Current implementation: src/app/s/[transferId]/page.tsx, src/app/s/[transferId]/manage/page.tsx and src/components/transfer-chrome.tsx.
- Current mobile review: /tmp/sharemeatsack-file-page-mobile-review.png. The footer has small inline links; the file summary joins filename and raw byte count into one line.
- Existing contracts: specs/transfers/files/moving-files.md, specs/transfers/sends/sending.md and specs/transfers/requests/requesting.md.
- MDN video codec guide: https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Video_codecs
- MDN HTTP range requests: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Range_requests
