import { createHmac, timingSafeEqual } from "node:crypto";
import type { ObjectStore } from "./object-store";
import { LibraryError, type LibraryCleanupTarget } from "./library-metadata";

export function verifyLibraryCleanupSignature(
  payload: string,
  header: string | null,
  secret: string,
) {
  if (!header || !secret) return false;
  const fields = new Map(
    header.split(",").map((part) => {
      const separator = part.indexOf("=");
      return [part.slice(0, separator).trim(), part.slice(separator + 1).trim()] as const;
    }),
  );
  const seconds = Number(fields.get("t")),
    actual = fields.get("v1");
  if (!actual || !Number.isFinite(seconds) || Math.abs(Date.now() - seconds * 1000) > 300_000)
    return false;
  const expected = createHmac("sha256", secret)
    .update(`${seconds}.library-cleanup.${payload}`)
    .digest("hex");
  const left = Buffer.from(actual),
    right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Only frozen removed records may be cleaned; confirmation precedes quota release. */
export async function deleteLibraryObjects(
  file: LibraryCleanupTarget,
  objects: ObjectStore,
  now: number,
) {
  if (
    file.visible ||
    file.state !== "removing" ||
    file.references.length ||
    (file.sealDeadlineAt ?? 0) > now
  )
    return false;
  if (
    !/^[A-Za-z0-9_-]{1,128}$/.test(file.id) ||
    file.uploadKey !== `sharemeatsack/library/${file.id}/upload` ||
    (file.objectKey &&
      (!file.scanAttemptId ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(file.scanAttemptId) ||
        file.objectKey !== `sharemeatsack/library/${file.id}/sealed/${file.scanAttemptId}`))
  )
    throw new LibraryError("storage_unavailable", 503);
  if (file.objectKey) {
    if (await objects.head(file.objectKey)) await objects.delete(file.objectKey);
    if (await objects.head(file.objectKey)) throw new LibraryError("storage_unavailable", 503);
  }
  if (await objects.head(file.uploadKey)) await objects.delete(file.uploadKey);
  if (file.uploadExpiresAt > now || (file.cleanupAt ?? 0) > now) return false;
  if (await objects.head(file.uploadKey)) throw new LibraryError("storage_unavailable", 503);
  return true;
}
