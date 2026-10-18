import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ObjectStore } from "./object-store";
import { libraryFileSchema, type LibraryMetadata } from "./library-metadata";
import { libraryFileView } from "./library";
import { OwnedTransferError } from "./owned-transfer-metadata";
import { sendCreateSchema, TRANSFER_DEFAULT_TTL_SECONDS } from "./schema";
import { createToken } from "./tokens";
import { urlsFor } from "./transfers";
import type { Transfer } from "./transfer-store";

const createSchema = sendCreateSchema
  .pick({ title: true, message: true, expiresInSeconds: true })
  .extend({
    id: z.string().uuid(),
    libraryFileIds: z
      .array(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/))
      .min(1)
      .max(100),
  })
  .strict();
const keepingSchema = z.object({ id: z.string().uuid() }).strict();
const copySchema = z.object({
  file: libraryFileSchema,
  sourceKey: z.string(),
  status: z.enum(["copying", "kept"]),
});

export function createOwnedWorkspaceService(deps: {
  accountId: string;
  metadata: LibraryMetadata;
  objects: ObjectStore | null;
  baseUrl: string;
  now?: () => Date;
}) {
  function owned(value: unknown) {
    const file = libraryFileSchema.parse(value);
    if (file.accountId !== deps.accountId) throw new OwnedTransferError("not_found", 404);
    return file;
  }
  return {
    async createSend(body: unknown) {
      const input = createSchema.parse(body);
      if (new Set(input.libraryFileIds).size !== input.libraryFileIds.length)
        throw new OwnedTransferError("invalid_request", 400);
      const now = deps.now?.() ?? new Date();
      const transfer: Transfer = {
        id: input.id,
        ownerAccountId: deps.accountId,
        kind: "send",
        title: input.title,
        ...(input.message ? { message: input.message } : {}),
        createdAt: now.toISOString(),
        expiresAt: new Date(
          now.getTime() + (input.expiresInSeconds ?? TRANSFER_DEFAULT_TTL_SECONDS) * 1000,
        ).toISOString(),
        status: "ready",
        publicToken: createToken(),
        agentToken: createToken(),
      };
      const result = await deps.metadata.call("createFromLibrary", {
        accountId: deps.accountId,
        transfer: JSON.stringify(transfer),
        libraryFileIds: input.libraryFileIds,
      });
      if (typeof result !== "string") throw new OwnedTransferError("unavailable", 503);
      const stored = JSON.parse(result) as Transfer;
      if (
        stored.id !== input.id ||
        stored.ownerAccountId !== deps.accountId ||
        stored.kind !== "send"
      )
        throw new OwnedTransferError("unavailable", 503);
      return {
        id: stored.id,
        publicUrl: urlsFor(stored, deps.baseUrl).downloadUrl,
        expiresAt: stored.expiresAt,
      };
    },
    async keep(transferId: string, fileId: string, body: unknown) {
      const { id } = keepingSchema.parse(body);
      if (!deps.objects?.available()) throw new OwnedTransferError("unavailable", 503);
      const binding = { accountId: deps.accountId, transferId, fileId };
      const reservation = await deps.metadata.call("beginKeep", {
        ...binding,
        id,
        attemptId: randomUUID(),
      });
      if (reservation === null) throw new OwnedTransferError("file_unavailable", 409);
      const copy = copySchema.parse(reservation);
      const target = owned(copy.file);
      if (copy.status === "kept") return { file: libraryFileView(target), status: "kept" as const };
      if (
        !target.objectKey ||
        !target.scanAttemptId ||
        target.state !== "sealing" ||
        target.visible
      )
        throw new OwnedTransferError("unavailable", 503);
      // Only server-selected frozen keys may be copied. File bytes stay inside R2.
      const expectedKey = `sharemeatsack/library/${target.id}/sealed/${target.scanAttemptId}`;
      if (
        target.objectKey !== expectedKey ||
        !/^sharemeatsack\/owned\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/sealed\/[A-Za-z0-9_-]+$/.test(
          copy.sourceKey,
        )
      )
        throw new OwnedTransferError("unavailable", 503);
      await deps.objects.copy(copy.sourceKey, target.objectKey);
      const head = await deps.objects.head(target.objectKey);
      if (!head || head.size !== target.size) {
        await deps.metadata.call("abortKeep", { ...binding, id: target.id });
        throw new OwnedTransferError("file_unavailable", 409);
      }
      const committed = await deps.metadata.call("commitKeep", {
        ...binding,
        id: target.id,
        attemptId: target.scanAttemptId,
        observedBytes: head.size,
      });
      if (committed === null) throw new OwnedTransferError("file_unavailable", 409);
      const file = owned(committed);
      if (!file.visible || file.state !== "available")
        throw new OwnedTransferError("file_unavailable", 409);
      return { file: libraryFileView(file), status: "kept" as const };
    },
    async abortKeep(transferId: string, fileId: string, body: unknown) {
      const { id } = keepingSchema.parse(body);
      const result = await deps.metadata.call("abortKeep", {
        accountId: deps.accountId,
        transferId,
        fileId,
        id,
      });
      if (result === null) return { state: "stopped" as const };
      const parsed = z
        .object({ file: libraryFileSchema, status: z.enum(["kept", "cleaning"]) })
        .parse(result);
      const file = owned(parsed.file);
      return parsed.status === "kept"
        ? { state: "kept" as const, file: libraryFileView(file) }
        : { state: "cleanup-pending" as const };
    },
  };
}
