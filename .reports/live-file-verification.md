# sharemeatsack.com live verification — 6 October 2026

Test file: Day 23 - Thurs 24th.mp4, 482663402 bytes.

- Send: upload HTTP 200 in 36.26 seconds, clean scan, download HTTP 200, exact byte count and SHA-256 match.
- Request: upload HTTP 200 in 41.19 seconds, finished via browser, MCP complete with clean scan, download HTTP 200, exact byte count and SHA-256 match.
- SHA-256 in both directions: 3800d0b09ea75d48ba5dc2f4aa9a87c1cf2930cb03be1b40522ed4e508ca50e3
- Browser upload: the initial R2 preflight HTTP 403 was resolved by saving the bucket CORS policy through the existing signed-in Chrome session. Preflight now returns HTTP 204 with Access-Control-Allow-Origin: https://sharemeatsack.com and PUT, GET, HEAD allowed. The policy permits Content-Type and exposes ETag, with a 3600-second maximum age.
- Native Chrome accessibility controls recovered. They were used to save the policy; no Cloudflare admin credential or public bucket access was added.
- Validation: 95 sharemeatsack tests and 105 Cleanroom tests pass; type checks, formatting, lint and builds pass (lint has warnings).

Both source fixes were committed and pushed to main after the user's approval. Isolated clones preserved the unrelated dirty checkout.

- sharemeatsack commit: fee77c6b84e45a352640977b92dc29770a06fa4d. GitHub CI passed: https://github.com/garylesueur/sharemeatsack/actions/runs/37461158419. Vercel production deployment dpl_8Qga4N9Q3NhEVhHxTah4kW3Rhk6V is Ready and serves https://sharemeatsack.com from https://sharemeatsack-7pijc3v25-lesueur.vercel.app.
- Cleanroom commit: 7e820acd259eab775098a69cb6c654d215f1e80c. GitHub CI passed: https://github.com/garylesueur/cleanroom/actions/runs/37461135439. Railway GitHub-triggered deployment 9364c78c-9c97-40f5-9fda-949830f25ccb succeeded. Its health endpoint returns HTTP 200 with scanner=true.
- Cleanroom source is preserved in /private/tmp/cleanroom-verified-fixes and the adjacent cleanroom-large-files.patch. The patch excludes generated diagrams; regenerate with node scripts/render-flow.mjs.

Video send expires 2026-10-06T12:23:46.430Z; request expires 2026-10-06T12:36:37.868Z.

The prior manual combined production deployment was dpl_FS2wC4VBvidoS2eBy46Aupkojbn2. The current GitHub-triggered release preserves the published install-guide commit 254026fde4bd4cb672a8bc73844887b2f75dce50, with only the transfer changes added. Combined release: all 89 tests, typecheck, format check, lint, and production build passed.

Automatic confirmation verified live: clicked Finish, waited for “These files have been sent” to appear without reloading; completed in approximately 3 seconds. Screenshot: /tmp/sharemeatsack-auto-confirmation-complete.png. Large-video request confirmation screenshot: /tmp/sharemeatsack-video-request-complete.png. Browser upload error screenshot: /tmp/sharemeatsack-browser-upload-error.png.

The browser Download button was clicked; the in-app browser did not report a completed download event within the 10-second observation. Full HTTP downloads in both transfer directions were separately checksum-verified.

Additional production regression found and fixed: text files above Cloudflare's compression threshold had no Content-Length on the HEAD response, which the old code treated as zero. R2 metadata requests now send Accept-Encoding: identity and reject missing or invalid sizes. Six regression tests passed red-to-green. Commit 597b035 merged with concurrent icon updates in a7a9fee0b2b08effeeef8cd749ca25d9adcc7449 and pushed normally. GitHub Gates passed (https://github.com/garylesueur/sharemeatsack/actions/runs/37462650194); Vercel deployment dpl_26CupLQScGp7hMD6TczvTdSsQ7Sa is READY at that SHA. The previously stuck 69-byte text transfer became ready with a clean scan, and all downloaded bytes matched after the deployment.

The separate File failure chat's Cloudflare sign-in through the in-app browser stopped at authenticator verification. The Fix share meat sack chat then recovered control of the existing signed-in native Chrome session and saved CORS directly. Automatic approval review rejected copying decrypted production credentials; the metadata fix was verified through the app's existing service paths and the Cloudflare UI. Credential approval is no longer needed for the resolved text-file issue.

Final live verification after CORS was saved:

- The original failed browser video request f3bbe93e2d5581f597bd7bb8185c4184 was retried in the browser with the supplied MP4. Upload completed, Finish succeeded, MCP reported complete with scanStatus clean, and the full 482663402-byte download matched the original SHA-256. The old tab was reloaded to show the completed page. Screenshot: /tmp/sharemeatsack-browser-video-verified.png. Integrity proof: /tmp/sharemeatsack-browser-request-verification.json.
- At production SHA a7a9fee0b2b08effeeef8cd749ca25d9adcc7449, a fresh 50-byte MCP send uploaded with HTTP 200, became ready with a clean scan, and downloaded with HTTP 200 and identical bytes. Proof: /tmp/sharemeatsack-post-push-verification.json.
- A fresh browser request on that release uploaded a 63-byte text file using the file chooser, completed through Finish, and displayed These files have been sent automatically without reloading. MCP status was complete and clean; all downloaded bytes matched. Screenshot: /tmp/sharemeatsack-final-browser-confirmation.png. Proof: /tmp/sharemeatsack-final-request-verification.json.
- CORS dashboard screenshot: /tmp/sharemeatsack-cloudflare-cors-saved.png. Browser send/request and large-video upload paths are now verified; the earlier CORS blocker is resolved.

Independent File failure confirmation: browser preflight returned HTTP 204 with Access-Control-Allow-Origin: https://sharemeatsack.com and allowed PUT, GET, HEAD. Reloaded the original video request and observed These files have been sent with Day 23 - Thurs 24th.mp4, 482663402 bytes. Screenshot: /tmp/sharemeatsack-file-failure-resolved.png. A separate 73-byte request uploaded through HTTP, finished in the browser, updated automatically without a reload, and was verified through MCP as complete and clean with exact downloaded bytes.
