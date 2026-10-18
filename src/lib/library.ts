import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  isTakeableScan,
  scanStatusFromVerdict,
  SCAN_LINK_TTL_SECONDS,
  type Cleanroom,
  type CleanroomVerdict,
} from "./cleanroom";
import { FILE_MAX_BYTES, SCAN_SIZE_CAP_BYTES } from "./schema";
import {
  libraryFileSchema,
  LibraryError,
  type LibraryFile,
  type LibraryMetadata,
} from "./library-metadata";
import type { ObjectStore } from "./object-store";
import { deleteLibraryObjects } from "./library-cleanup";

const offered = z
  .object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(255),
    type: z.string().max(255).default("application/octet-stream"),
    size: z.number().int().min(0).max(FILE_MAX_BYTES),
  })
  .strict();
const pageSchema = z.object({
  files: z.array(libraryFileSchema),
  nextCursor: z.string().nullable(),
  usedBytes: z.number().nonnegative(),
  allowanceBytes: z.number().positive(),
});
export function libraryFileView(file: LibraryFile) {
  return {
    id: file.id,
    name: file.name,
    type: file.contentType,
    size: file.size,
    state: file.state,
    scanStatus: file.scanStatus,
    scanReason: file.scanReason,
    createdAt: new Date(file.createdAt).toISOString(),
  };
}
export type LibraryFileView = ReturnType<typeof libraryFileView>;
export function createLibraryService(deps: {
  accountId: string;
  metadata: LibraryMetadata;
  objects: ObjectStore | null;
  scanner: Cleanroom | null;
  baseUrl: string;
  callbackUrl: string;
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());
  const absolute = (url: string) => new URL(url, deps.baseUrl).href;
  function objects() {
    if (!deps.objects?.available()) throw new LibraryError("storage_unavailable", 503);
    return deps.objects;
  }
  function owned(value: unknown): LibraryFile {
    const file = libraryFileSchema.parse(value);
    if (file.accountId !== deps.accountId) throw new LibraryError("not_found", 404);
    return file;
  }
  async function record(id: string, visible = true) {
    const file = owned(await deps.metadata.call("get", { id }));
    if (visible && !file.visible) throw new LibraryError("not_found", 404);
    return file;
  }
  async function apply(file: LibraryFile, verdict: CleanroomVerdict) {
    const applied = await deps.metadata.call("applyScan", {
      id: file.id,
      attemptId: file.scanAttemptId,
      status: scanStatusFromVerdict(verdict),
      ...(verdict.verdict === "infected"
        ? { reason: verdict.signature }
        : verdict.verdict === "failed"
          ? { reason: verdict.reason }
          : {}),
    });
    if (
      applied === true &&
      verdict.verdict === "infected" &&
      file.objectKey &&
      !file.references.length
    )
      await objects().delete(file.objectKey);
    return record(file.id);
  }
  async function refresh(file: LibraryFile) {
    if (file.state !== "scanning" || !file.scanHandle || !deps.scanner?.available()) return file;
    try {
      const result = await deps.scanner.poll(file.scanHandle);
      if (result?.verdict) return apply(file, result.verdict);
    } catch {
      /* A transient poll failure preserves the blocked scanning state. */
    }
    return file;
  }
  async function cleanup(file: LibraryFile) {
    if (await deleteLibraryObjects(file, objects(), now().getTime())) {
      await deps.metadata.call("release", { id: file.id });
    }
  }
  return {
    async list(input: { limit: number; cursor: string | null; search?: string }) {
      const garbage = z
        .array(libraryFileSchema)
        .parse(await deps.metadata.call("garbage", { limit: 25 }));
      // Cleanup is opportunistic; an outage must not hide otherwise readable metadata.
      await Promise.all(
        garbage.map(async (file) => {
          if (file.accountId === deps.accountId) {
            try {
              await cleanup(file);
            } catch {
              /* Reservation remains. */
            }
          }
        }),
      );
      const page = pageSchema.parse(await deps.metadata.call("list", input));
      const files = await Promise.all(page.files.map((file) => refresh(owned(file))));
      return {
        files: files.map(libraryFileView),
        nextCursor: page.nextCursor,
        usedBytes: page.usedBytes,
        allowanceBytes: page.allowanceBytes,
      };
    },
    async get(id: string) {
      return libraryFileView(await refresh(await record(id)));
    },
    async offer(body: unknown) {
      const input = offered.parse(body);
      const store = objects();
      const file = owned(
        await deps.metadata.call("reserve", {
          id: input.id ?? randomUUID(),
          name: input.name,
          contentType: input.type || "application/octet-stream",
          size: input.size,
        }),
      );
      if (file.state !== "uploading" || file.uploadExpiresAt <= now().getTime())
        throw new LibraryError("upload_not_open", 409);
      const signed = await store.presignPut({
        key: file.uploadKey,
        contentType: file.contentType,
        contentLength: file.size,
        expiresInSeconds: Math.max(1, Math.floor((file.uploadExpiresAt - now().getTime()) / 1000)),
      });
      return {
        file: libraryFileView(file),
        uploadUrl: absolute(signed.url),
        expiresAt: signed.expiresAt,
      };
    },
    async retryUpload(id: string) {
      const file = await record(id);
      if (file.state !== "uploading" || file.uploadExpiresAt <= now().getTime())
        throw new LibraryError("upload_not_open", 409);
      const signed = await objects().presignPut({
        key: file.uploadKey,
        contentType: file.contentType,
        contentLength: file.size,
        expiresInSeconds: Math.max(1, Math.floor((file.uploadExpiresAt - now().getTime()) / 1000)),
      });
      return {
        file: libraryFileView(file),
        uploadUrl: absolute(signed.url),
        expiresAt: signed.expiresAt,
      };
    },
    async complete(id: string) {
      const existing = await record(id);
      if (existing.state !== "uploading") return libraryFileView(await refresh(existing));
      const store = objects();
      const head = await store.head(existing.uploadKey);
      if (!head || head.size !== existing.size) throw new LibraryError("incomplete_upload", 409);
      const attemptId = randomUUID();
      const file = owned(await deps.metadata.call("beginSeal", { id, attemptId }));
      try {
        if (!file.objectKey) throw new LibraryError("storage_unavailable", 503);
        await store.copy(file.uploadKey, file.objectKey);
        const sealed = await store.head(file.objectKey);
        if (!sealed || sealed.size !== file.size) throw new LibraryError("incomplete_upload", 409);
        let handle: string | null = null;
        let verdict: CleanroomVerdict | null = null;
        if (file.size > SCAN_SIZE_CAP_BYTES)
          verdict = {
            verdict: "too-large",
            declaredSizeBytes: file.size,
            capBytes: SCAN_SIZE_CAP_BYTES,
          };
        else if (!deps.scanner?.available())
          verdict = { verdict: "failed", reason: "Scanner is unavailable" };
        else {
          try {
            const scanRead = await store.presignGet({
              key: file.objectKey,
              filename: file.name,
              contentType: file.contentType,
              expiresInSeconds: SCAN_LINK_TTL_SECONDS,
            });
            const result = await deps.scanner.submit({
              url: absolute(scanRead.url),
              callbackUrl: deps.callbackUrl,
              declaredSizeBytes: file.size,
              submissionKey: `library:${file.id}:${attemptId}`,
            });
            handle = result.handle;
            verdict = result.verdict;
          } catch {
            verdict = { verdict: "failed", reason: "Scan could not be started" };
          }
        }
        await deps.metadata.call("startScan", {
          id,
          attemptId,
          observedBytes: sealed.size,
          handle,
        });
        if (verdict)
          return libraryFileView(
            await apply({ ...file, scanHandle: handle ?? undefined }, verdict),
          );
        return libraryFileView(await record(id));
      } catch (error) {
        await deps.metadata.call("failSeal", { id, attemptId });
        throw error;
      }
    },
    async readUrl(id: string, purpose: "preview" | "download") {
      const file = await refresh(await record(id));
      if (file.state !== "available" || !isTakeableScan(file.scanStatus) || !file.objectKey)
        throw new LibraryError("file_unavailable", 409);
      const store = objects();
      if (!(await store.head(file.objectKey))) throw new LibraryError("file_unavailable", 404);
      async function requireCurrentRead() {
        const current = await record(id);
        if (
          current.state !== "available" ||
          !isTakeableScan(current.scanStatus) ||
          current.objectKey !== file.objectKey
        )
          throw new LibraryError("file_unavailable", 409);
      }
      // Referenced storage may survive removal. Re-read owner authority after
      // each asynchronous wait instead of treating object presence as permission.
      await requireCurrentRead();
      const signed = await store.presignGet({
        key: file.objectKey,
        filename: file.name,
        contentType: file.contentType,
        purpose,
      });
      await requireCurrentRead();
      return { url: absolute(signed.url), expiresAt: signed.expiresAt };
    },
    async remove(id: string) {
      const file = owned(await deps.metadata.call("remove", { id }));
      await cleanup(file);
      return { ok: true };
    },
  };
}
