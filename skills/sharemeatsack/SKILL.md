---
name: sharemeatsack
description: >
  Puts files on a sharemeatsack.com page, or gets files from a person. Confirm
  who they are when someone will open the link. Create a request or a send,
  paste the page link, and wait. Use when you need invoices, photos, PDFs, or
  any files from someone, or when you need to put files on meatsack or give
  them to someone. Do not mail the files yourself and do not pull large files
  into the conversation.
---

# sharemeatsack.com

Create a request or a send, put the human link where they will see it, then wait. Do not invent another file host, a gist, or an email attachment.

The product is **sharemeatsack.com**. The tool is named `sharemeatsack.com`. HTTP and the tool are the same transfer. Human links look like `https://sharemeatsack.com/s/…`.

There is no API key. Create is open today. The person who opens the link never signs in. After create, keep `pollUrl` (or its `token`) and `manageUrl` for status, wait, cancel, and inspect.

## Get files from a person

1. Confirm who they are, and that you already know how to reach them — this chat, Slack, mail. Do not create a request for a guessed address. This product has no contacts book.
2. Call `sharemeatsack.com` with action `request` (or `POST /api/v1/transfers` with `"action": "request"`). Send a title, optional message, optional expiry, optional caps (`maxFiles`, `maxFileSize`, `allowedTypes`), optional metadata, and optional `callbackUrl`.
3. You always get `uploadUrl`, `pollUrl`, and `manageUrl` immediately. Paste **`uploadUrl` into this conversation** so they can open it. Keep `manageUrl` for yourself. Do not put `manageUrl` or the agent token on the upload page.
4. Wait with action `wait` (pass `transferId` and `agentToken` from `pollUrl`). One call sits for up to 50 seconds. If it is still open the reply says `timedOut: true` and `nextAction: "wait"`: **call `wait` again, and keep calling.** Someone taking ten minutes or two hours is the normal case.
5. When status is `complete`, read the file list (`status`, `wait`, or action `files`). You get names, sizes, types, scan status, and short-lived download URLs. You never get file bytes. Do not fetch a large file into the conversation.

## Put files on meatsack (or send them to a person)

“Put them on meatsack” and “send them to Simon” are the same send. The files go on a page. Simon, if anyone, just gets that page’s link.

1. If they named a person, confirm who they are and that you already know how to reach them. If they only asked to put the files on meatsack, skip that.
2. Call `sharemeatsack.com` with action `send` (or `POST /api/v1/transfers` with `"action": "send"`). Send a title, optional message, optional expiry, and `files` as `{ name, type, size }[]` — never bytes.
3. You get one short-lived upload URL per file, plus `downloadUrl`, `pollUrl`, and `manageUrl`. **PUT the bytes at those upload URLs yourself.** Refresh a URL if it is close to expiry. The download link does not serve files until every offered file has arrived.
4. Wait until status is `ready`, then paste **`downloadUrl`.** If they named a person, put it where that person will see it. If they only said put them on meatsack, paste it in this conversation. Do not paste it before the files have landed. Delivery is your job. This service does not send mail.
5. Each file on the page is its own download. There is no zip of everything.

## Someone who is not in this conversation

Giving `uploadUrl` or `downloadUrl` to them is **your** job. They get the same page link you would paste here. This service does not send mail and does not post to other chats. Then wait the same way as above.

## Do not

- Name extra tools. There is one tool, `sharemeatsack.com`, with actions `request`, `send`, `status`, `wait`, `cancel`, and `files`.
- Put the agent status secret or `manageUrl` on the human page or anywhere the person should not see it.
- Treat Slack or email posting as a feature of this product.
- Pull a large file into the chat, or attach the files to mail yourself.
- Put file bytes in the tool argument or expect them in the tool result.
