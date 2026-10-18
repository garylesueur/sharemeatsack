import { z } from "zod";
import type { LibraryMetadata } from "./library-metadata";
import { OwnedTransferError } from "./owned-transfer-metadata";
import type { OwnerPage, Transfer, TransferStore, TransferUpdate } from "./transfer-store";

export const transferSchema = z.object({
  id: z.string().min(1),
  ownerAccountId: z.string().min(1),
  kind: z.enum(["request", "send"]),
  createdAt: z.string(),
  expiresAt: z.string(),
  cancelledAt: z.string().optional(),
  completedAt: z.string().optional(),
  status: z.enum(["open", "scanning", "complete", "ready", "expired", "cancelled"]),
  title: z.string(),
  message: z.string().optional(),
  publicToken: z.string(),
  agentToken: z.string(),
  metadata: z.record(z.string()).optional(),
  callbackUrl: z.string().optional(),
  callbackSent: z.boolean().optional(),
  maxFiles: z.number().optional(),
  maxFileSize: z.number().optional(),
  allowedTypes: z.array(z.string()).optional(),
  files: z
    .array(
      z.object({
        id: z.string(),
        filename: z.string(),
        contentType: z.string(),
        size: z.number().int().nonnegative(),
        key: z.string().optional(),
        libraryFileId: z.string().optional(),
        uploadExpiresAt: z.string().optional(),
        receivedAt: z.string().optional(),
        retainedUntil: z.string().optional(),
        state: z.enum(["pending", "accepted"]),
        scanStatus: z.string().optional(),
        scanHandle: z.string().optional(),
        scanSignature: z.string().optional(),
        scanReason: z.string().optional(),
      }),
    )
    .optional(),
});
const pageSchema = z.object({ records: z.array(z.string()), nextCursor: z.string().nullable() });
const pointerSchema = z.object({ transferId: z.string(), fileId: z.string() });
const retiredSchema = z.object({ retired: z.literal(true) }).strict();

function decode(value: unknown): Transfer | "retired" | null {
  if (value === null) return null;
  if (retiredSchema.safeParse(value).success) return "retired";
  try {
    if (typeof value !== "string") throw new Error("Invalid durable transfer");
    return transferSchema.parse(JSON.parse(value));
  } catch {
    throw new OwnedTransferError("unavailable", 503);
  }
}
function cursor(page: OwnerPage) {
  if (!page.cursor) return { source: "durable", value: null } as const;
  if (page.cursor.length > 4096) throw new OwnedTransferError("invalid_page", 400);
  if (page.cursor.startsWith("d:"))
    return { source: "durable", value: page.cursor.slice(2) || null } as const;
  if (page.cursor.startsWith("l:"))
    return { source: "legacy", value: page.cursor.slice(2) || null } as const;
  // Preserve existing owner-list cursors without importing the old rows.
  if (!/^[0-9TZ:.+-]+\|[A-Za-z0-9_-]+$/.test(page.cursor))
    throw new OwnedTransferError("invalid_page", 400);
  return { source: "legacy", value: page.cursor } as const;
}

/** New owned authority is durable; a failed durable read never revives a cache. */
export function createOwnedTransferStore(input: {
  legacy: TransferStore;
  metadata: LibraryMetadata;
}): TransferStore {
  const durable = async (id: string) => {
    const result = decode(await input.metadata.call("getById", { id }));
    if (result && result !== "retired" && result.id !== id)
      throw new OwnedTransferError("unavailable", 503);
    return result;
  };
  async function classification(updates: TransferUpdate[]) {
    const values = await Promise.all(updates.map(({ before }) => durable(before.id)));
    if (values.some((value) => value === "retired")) return "refused";
    if (values.every((value) => value === null)) return "legacy";
    if (values.every((value) => value !== null)) return "durable";
    return "refused";
  }
  const begin = input.legacy.beginClaim?.bind(input.legacy);
  const inspect = input.legacy.inspectClaim?.bind(input.legacy);
  const resolve = input.legacy.resolveClaim?.bind(input.legacy);
  const claims: Partial<TransferStore> =
    begin && inspect && resolve
      ? {
          async beginClaim(id, accountId, attemptId, proof) {
            // Only a definitive missing native row allows legacy source capture.
            if ((await input.metadata.call("getById", { id })) !== null) return null;
            return begin(id, accountId, attemptId, proof);
          },
          inspectClaim: inspect,
          // Trusted closed-intent reconciliation must reach the original source even
          // after native publication/account retirement makes the overlay authoritative.
          resolveClaim: resolve,
        }
      : {};
  return {
    ...claims,
    async save(transfer) {
      if (transfer.ownerAccountId) {
        const result = await input.metadata.call("save", { transfer: JSON.stringify(transfer) });
        // Convex void mutations return null. An explicit refusal is not admission.
        if (result !== null && result !== true) throw new OwnedTransferError("unavailable", 503);
      } else await input.legacy.save(transfer);
    },
    async getById(id) {
      const value = await durable(id);
      return value === "retired" ? null : (value ?? input.legacy.getById(id));
    },
    async fileAccess(id) {
      const value = await durable(id);
      if (value === "retired") return [];
      if (value === null) return input.legacy.fileAccess ? input.legacy.fileAccess(id) : null;
      const result = z
        .object({ fileIds: z.array(z.string()).max(100) })
        .safeParse(await input.metadata.call("fileAccess", { id }));
      if (!result.success) throw new OwnedTransferError("unavailable", 503);
      return result.data.fileIds;
    },
    async keptFiles(account, id) {
      const value = await durable(id);
      if (!value || value === "retired" || value.ownerAccountId !== account) return {};
      const result = z
        .object({
          keptFiles: z
            .record(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), z.string().uuid())
            .default({}),
        })
        .safeParse(await input.metadata.call("fileAccess", { id }));
      if (!result.success || Object.keys(result.data.keptFiles).length > 100)
        throw new OwnedTransferError("unavailable", 503);
      return result.data.keptFiles;
    },
    async compareAndSave(updates) {
      if (
        updates.length === 0 ||
        new Set(updates.map(({ before }) => before.id)).size !== updates.length ||
        updates.some(
          ({ before, after }) =>
            before.id !== after.id || before.ownerAccountId !== after.ownerAccountId,
        )
      )
        throw new Error("Transfer updates must preserve distinct ids and ownership");
      const source = await classification(updates);
      if (source === "refused") return false;
      if (source === "legacy") return input.legacy.compareAndSave(updates);
      // Cross-account bytes/reference authority requires a separately agreed contract.
      if (new Set(updates.map(({ before }) => before.ownerAccountId)).size !== 1) return false;
      return (
        (await input.metadata.call("compareAndSave", {
          updates: updates.map(({ before, after }) => ({
            before: JSON.stringify(before),
            after: JSON.stringify(after),
          })),
        })) === true
      );
    },
    async delete(id) {
      const value = await durable(id);
      if (value === "retired") return;
      if (value === null) await input.legacy.delete(id);
      else await input.metadata.call("delete", { id });
    },
    async listByOwner(accountId, page) {
      if (!Number.isInteger(page.limit) || page.limit < 1 || page.limit > 100)
        throw new OwnedTransferError("invalid_page", 400);
      const next = cursor(page);
      let records: Transfer[] = [];
      if (next.source === "durable") {
        const result = pageSchema.parse(
          await input.metadata.call("listByOwner", {
            accountId,
            limit: page.limit,
            cursor: next.value,
            ...(page.kind ? { kind: page.kind } : {}),
          }),
        );
        if (result.records.length > page.limit) throw new OwnedTransferError("unavailable", 503);
        records = result.records.map((value) => {
          const record = decode(value);
          if (
            !record ||
            record === "retired" ||
            record.ownerAccountId !== accountId ||
            (page.kind && record.kind !== page.kind)
          )
            throw new OwnedTransferError("unavailable", 503);
          return record;
        });
        if (result.nextCursor !== null) return { records, nextCursor: `d:${result.nextCursor}` };
        if (records.length === page.limit) return { records, nextCursor: "l:" };
      }
      const legacy = await input.legacy.listByOwner(accountId, {
        ...page,
        limit: page.limit - records.length,
        cursor: next.source === "legacy" ? (next.value ?? undefined) : undefined,
      });
      // A legacy snapshot cannot duplicate or resurrect durable/retired history.
      const legacyAuthority = await Promise.all(legacy.records.map((record) => durable(record.id)));
      return {
        records: [
          ...records,
          ...legacy.records.filter((_, index) => legacyAuthority[index] === null),
        ],
        ...(legacy.nextCursor ? { nextCursor: `l:${legacy.nextCursor}` } : {}),
      };
    },
    async indexScan(handle, pointer) {
      const value = await durable(pointer.transferId);
      if (value === "retired") return;
      if (value === null) await input.legacy.indexScan(handle, pointer);
      else await input.metadata.call("indexScan", { handle, pointer });
    },
    async lookupScan(handle) {
      const value = await input.metadata.call("lookupScan", { handle });
      if (value === null) return input.legacy.lookupScan(handle);
      if (retiredSchema.safeParse(value).success) return null;
      return pointerSchema.parse(value);
    },
  };
}
