import { ZodError } from "zod";
import { accountUnauthorized, privateAccountResponse, verifyAccountRequest } from "./account-api";
import { getDefaultObjectStore, getDefaultStore, getDefaultTransferService } from "./app-transfers";
import { createIncomingService } from "./incoming";
import { createOwnedTransferMetadata, OwnedTransferError } from "./owned-transfer-metadata";
import { PRODUCT_ORIGIN } from "./product";
import { publicOrigin } from "./public-origin";

const json = (body: unknown, status = 200) =>
  privateAccountResponse(Response.json(body, { status }));
export type IncomingOperation =
  | "resolve"
  | "save"
  | "list"
  | "get"
  | "remove"
  | "open"
  | "keep"
  | "abortKeep";

/** Bound streamed bodies as well as Content-Length; recipient URLs contain private bearer access. */
async function readBody(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > 2048)
    throw new OwnedTransferError("invalid_request", 400);
  const reader = request.body?.getReader();
  if (!reader) throw new OwnedTransferError("invalid_request", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      // Stream chunks depend on the preceding read; this cannot be parallelized.
      // eslint-disable-next-line no-await-in-loop
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 2048) {
        // Finish cancelling the reader before releasing its lock.
        // eslint-disable-next-line no-await-in-loop
        await reader.cancel();
        throw new OwnedTransferError("invalid_request", 400);
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown;
  } catch {
    throw new OwnedTransferError("invalid_request", 400);
  }
}

export async function incomingRequest(
  request: Request,
  operation: IncomingOperation,
  id?: string,
  fileId?: string,
) {
  const authority = await verifyAccountRequest(request);
  if (authority.outcome !== "accepted") return accountUnauthorized();
  if (
    (id !== undefined &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) ||
    (fileId !== undefined && !/^[A-Za-z0-9_-]{1,128}$/.test(fileId))
  )
    return json({ error: "not_found" }, 404);
  const service = createIncomingService({
    accountId: authority.account,
    metadata: createOwnedTransferMetadata(),
    objects: getDefaultObjectStore(),
    origins: [publicOrigin(), PRODUCT_ORIGIN],
    store: getDefaultStore(),
    transfers: getDefaultTransferService(),
  });
  try {
    if (operation === "resolve") return json(await service.resolve(await readBody(request)));
    if (operation === "save") return json(await service.save(await readBody(request)), 201);
    if (operation === "list") {
      const query = new URL(request.url).searchParams;
      const limit = Number(query.get("limit") ?? 50);
      const cursor = query.get("cursor");
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100 ||
        (cursor?.length ?? 0) > 4096 ||
        [...query.keys()].some((key) => key !== "limit" && key !== "cursor")
      )
        return json({ error: "invalid_page" }, 400);
      return json(await service.list({ limit, cursor }));
    }
    if (!id) return json({ error: "not_found" }, 404);
    if (operation === "get") return json(await service.get(id));
    if (operation === "remove") return json(await service.remove(id));
    if (operation === "open") return json(await service.open(id));
    if (!fileId) return json({ error: "not_found" }, 404);
    return json(
      operation === "keep"
        ? await service.keep(id, fileId, await readBody(request))
        : await service.abortKeep(id, fileId, await readBody(request)),
    );
  } catch (error) {
    // Invalid backend data must remain an unavailable failure, rather than a successful empty list.
    if (error instanceof SyntaxError) return json({ error: "invalid_request" }, 400);
    if (error instanceof ZodError) return json({ error: "invalid_request" }, 400);
    if (error instanceof OwnedTransferError) return json({ error: error.code }, error.status);
    return json({ error: "unavailable" }, 503);
  }
}
