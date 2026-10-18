import { ZodError } from "zod";
import { accountUnauthorized, privateAccountResponse, verifyAccountRequest } from "./account-api";
import { getDefaultCleanroom, getDefaultObjectStore } from "./app-transfers";
import { publicOrigin } from "./public-origin";
import { scanCallbackOrigin } from "./scan-callback-origin";
import { createLibraryService } from "./library";
import { createLibraryMetadata, LibraryError } from "./library-metadata";

export type LibraryOperation =
  | "list"
  | "offer"
  | "get"
  | "remove"
  | "complete"
  | "retry"
  | "preview"
  | "download";
const json = (body: unknown, status = 200) =>
  privateAccountResponse(Response.json(body, { status }));
export async function libraryRequest(
  request: Request,
  operation: LibraryOperation,
  id?: string,
): Promise<Response> {
  const authority = await verifyAccountRequest(request);
  if (authority.outcome !== "accepted") return accountUnauthorized();
  if (id !== undefined && !/^[A-Za-z0-9_-]{1,128}$/.test(id))
    return json({ error: "not_found" }, 404);
  const origin = process.env.LANYARD_URL ?? "https://meatsack.puregaz.com";
  const service = createLibraryService({
    accountId: authority.account,
    metadata: createLibraryMetadata({
      origin,
      authorization: request.headers.get("authorization")!,
    }),
    objects: getDefaultObjectStore(),
    scanner: getDefaultCleanroom(),
    baseUrl: publicOrigin(),
    callbackUrl: new URL("/api/v1/library/scan-result", scanCallbackOrigin()).href,
  });
  try {
    if (operation === "list") {
      const query = new URL(request.url).searchParams;
      const limit = Number(query.get("limit") ?? 50);
      const cursor = query.get("cursor");
      const search = query.get("search") ?? undefined;
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100 ||
        (cursor?.length ?? 0) > 4096 ||
        (search?.length ?? 0) > 255
      )
        return json({ error: "invalid_page" }, 400);
      return json(await service.list({ limit, cursor, search }));
    }
    if (operation === "offer") return json(await service.offer(await request.json()), 201);
    if (!id) return json({ error: "not_found" }, 404);
    if (operation === "get") return json(await service.get(id));
    if (operation === "remove") return json(await service.remove(id));
    if (operation === "complete") return json(await service.complete(id));
    if (operation === "retry") return json(await service.retryUpload(id));
    return json(await service.readUrl(id, operation));
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError)
      return json({ error: "invalid_request" }, 400);
    if (error instanceof LibraryError) return json({ error: error.code }, error.status);
    return json({ error: "unavailable" }, 503);
  }
}
