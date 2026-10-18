import { z } from "zod";
import { boundedClaimBytes } from "./claim-body";
import type { Cleanroom } from "./cleanroom";
import type { LibraryMetadata } from "./library-metadata";

const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,256}$/);
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });

/** A signed scanner receipt wakes the worker. Fresh polling and immutable-target identity determine the verdict. */
export async function transferClaimScanRequest(
  request: Request,
  ports: {
    scanner: Cleanroom | null;
    metadata: LibraryMetadata;
    process(intentId: string): Promise<boolean>;
  },
) {
  try {
    if (request.method !== "POST" || new URL(request.url).search || !request.body)
      return json({ error: "invalid_request" }, 400);
    const payload = new TextDecoder("utf-8", { fatal: true }).decode(
      await boundedClaimBytes(request.body, 8192),
    );
    if (!ports.scanner?.verifyCallback(payload, request.headers.get("cleanroom-signature")))
      return json({ error: "not_found" }, 404);
    const input = z.object({ handle: identifier }).passthrough().safeParse(JSON.parse(payload));
    if (!input.success) return json({ error: "invalid_request" }, 400);
    const found = await ports.metadata.call("lookupClaimScan", { handle: input.data.handle });
    if (found === null) return json({ error: "not_found" }, 404);
    const pointer = z
      .object({ intentId: identifier, fileId: identifier })
      .strict()
      .safeParse(found);
    if (!pointer.success) return json({ error: "unavailable" }, 503);
    return (await ports.process(pointer.data.intentId))
      ? json({ ok: true })
      : json({ ok: false }, 409);
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}
