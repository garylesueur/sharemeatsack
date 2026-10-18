import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { LibraryMetadata } from "./library-metadata";
import type { ObjectStore } from "./object-store";
const targetSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    uploadKey: z.string(),
    objectKey: z.string().optional(),
    cleanupAt: z.number(),
  })
  .strict();
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
export function verifyTransferCleanupSignature(
  payload: string,
  header: string | null,
  secret: string,
  now: number = Date.now(),
) {
  if (!header || !secret) return false;
  const match = /^t=(\d{1,12}),v1=([a-f0-9]{64})$/.exec(header);
  if (!match || Math.abs(now - Number(match[1]) * 1000) > 300000) return false;
  const expected = createHmac("sha256", secret)
    .update(`${Number(match[1])}.transfer-cleanup.${payload}`)
    .digest();
  return timingSafeEqual(Buffer.from(match[2], "hex"), expected);
}
export async function ownedTransferCleanupRequest(
  request: Request,
  ports: {
    secret: string;
    metadata: LibraryMetadata;
    objects: ObjectStore | null;
    now?: () => number;
  },
) {
  try {
    const payload = await request.text();
    if (payload.length > 512) return json({ error: "invalid_request" }, 400);
    if (
      !verifyTransferCleanupSignature(
        payload,
        request.headers.get("transfer-cleanup-signature"),
        ports.secret,
        ports.now?.(),
      )
    )
      return json({ error: "unauthorized" }, 401);
    const parsed = z
      .object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) })
      .strict()
      .safeParse(JSON.parse(payload));
    if (!parsed.success) return json({ error: "invalid_request" }, 400);
    const authorized = await ports.metadata.call("authorizeCleanup", parsed.data);
    if (authorized === null) return json({ ok: false }, 409);
    const target = targetSchema.parse(authorized);
    const upload = /^sharemeatsack\/owned\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\/upload$/.exec(
      target.uploadKey,
    );
    const prefix = upload ? `sharemeatsack/owned/${upload[1]}/${upload[2]}/sealed/` : "";
    if (
      target.id !== parsed.data.id ||
      !upload ||
      upload[2] !== target.id ||
      target.cleanupAt > (ports.now?.() ?? Date.now()) ||
      (target.objectKey &&
        (!target.objectKey.startsWith(prefix) ||
          !/^[A-Za-z0-9_-]{1,128}$/.test(target.objectKey.slice(prefix.length))))
    )
      return json({ error: "unavailable" }, 503);
    if (!ports.objects?.available()) return json({ error: "unavailable" }, 503);
    // Confirm authority for these frozen keys immediately before storage deletion.
    const current = await ports.metadata.call("authorizeCleanup", parsed.data);
    if (current === null || JSON.stringify(targetSchema.parse(current)) !== JSON.stringify(target))
      return json({ ok: false }, 409);
    for (const key of [target.objectKey, target.uploadKey]) {
      if (!key) continue;
      if (await ports.objects.head(key)) await ports.objects.delete(key);
      if (await ports.objects.head(key)) return json({ ok: false }, 503);
    }
    return json({ ok: true });
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}
