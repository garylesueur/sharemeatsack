import { z } from "zod";
import { claimBindingSchema, type ClaimBinding } from "./claim-intent-client";
import type { LibraryMetadata } from "./library-metadata";
import { OwnedTransferError } from "./owned-transfer-metadata";
import { transferSchema } from "./owned-transfer-store";
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const date = z.string().refine((value) => Number.isFinite(Date.parse(value)));
// Do not strip extra native fields or descriptors: the exact JSON is retained.
export const claimSourceSchema = z
  .object({
    id: identifier,
    kind: z.enum(["send", "request"]),
    status: z.enum(["open", "scanning", "ready", "complete", "expired", "cancelled"]),
    title: z.string().min(1).max(255),
    createdAt: date,
    expiresAt: date,
    publicToken: z.string().min(1).max(256),
    agentToken: z.string().min(1).max(256),
    ownerAccountId: z.string().min(1).max(256).optional(),
    files: z.unknown().optional(),
  })
  .passthrough();
const nativeOwnedSchema = transferSchema
  .merge(claimSourceSchema)
  .extend({ ownerAccountId: z.string().min(1).max(256), files: transferSchema.shape.files })
  .passthrough();
const receiptSchema = z
  .object({
    state: z.literal("committed"),
    sourceId: identifier,
    id: identifier,
    attemptId: z.string().uuid(),
    snapshotHash: hash,
    transfer: z.string().max(500_000).nullable(),
  })
  .strict();
export type TransferClaimReceipt = z.infer<typeof receiptSchema>;
export type TransferClaimInput = ClaimBinding & { snapshotHash: string; transfer: string };
const importSchema = claimBindingSchema
  .extend({ snapshotHash: hash, transfer: z.string().min(2).max(500_000) })
  .strict();
const readSchema = z
  .object({
    accountId: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/),
    sourceId: identifier,
    snapshotHash: hash,
  })
  .strict();
export const claimUnavailable = () => new OwnedTransferError("storage_unavailable", 503);
function readReceipt(
  value: unknown,
  input: z.infer<typeof readSchema>,
  attemptId?: string,
): TransferClaimReceipt | null {
  if (value === null) return null;
  const result = receiptSchema.safeParse(value);
  if (
    !result.success ||
    result.data.sourceId !== input.sourceId ||
    result.data.id !== input.sourceId ||
    result.data.snapshotHash !== input.snapshotHash ||
    (attemptId && result.data.attemptId !== attemptId)
  )
    throw claimUnavailable();
  if (result.data.transfer !== null) {
    const owned = nativeOwnedSchema.parse(JSON.parse(result.data.transfer));
    if (owned.id !== input.sourceId || owned.ownerAccountId !== input.accountId)
      throw claimUnavailable();
  }
  return result.data;
}
export function createTransferClaimMetadata(metadata: LibraryMetadata) {
  return {
    async owned(id: string): Promise<z.infer<typeof nativeOwnedSchema> | "retired" | null> {
      try {
        const result = await metadata.call("getById", { id });
        if (result === null) return null;
        if (
          z
            .object({ retired: z.literal(true) })
            .strict()
            .safeParse(result).success
        )
          return "retired";
        if (typeof result !== "string" || Buffer.byteLength(result) > 500_000)
          throw claimUnavailable();
        const value = nativeOwnedSchema.parse(JSON.parse(result));
        if (value.id !== id) throw claimUnavailable();
        return value;
      } catch {
        throw claimUnavailable();
      }
    },
    async claimTransfer(input: TransferClaimInput): Promise<TransferClaimReceipt> {
      const checked = importSchema.safeParse(input);
      if (!checked.success) throw claimUnavailable();
      const result = readReceipt(
        await metadata.call("claimTransfer", checked.data),
        input,
        input.attemptId,
      );
      if (!result) throw claimUnavailable();
      return result;
    },
    async getClaim(input: z.infer<typeof readSchema>): Promise<TransferClaimReceipt | null> {
      const checked = readSchema.safeParse(input);
      if (!checked.success) throw claimUnavailable();
      try {
        return readReceipt(await metadata.call("getClaim", checked.data), input);
      } catch {
        throw claimUnavailable();
      }
    },
  };
}
export type TransferClaimMetadata = ReturnType<typeof createTransferClaimMetadata>;
