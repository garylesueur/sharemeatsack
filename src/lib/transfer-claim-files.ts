import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  SCAN_LINK_TTL_SECONDS,
  scanStatusFromVerdict,
  type Cleanroom,
  type CleanroomVerdict,
} from "./cleanroom";
import type { LibraryMetadata } from "./library-metadata";
import { OwnedTransferError } from "./owned-transfer-metadata";
import type { ObjectStore } from "./object-store";
import { SCAN_SIZE_CAP_BYTES } from "./schema";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const opaque = z.string().regex(/^[A-Za-z0-9_-]{1,256}$/);
const uuid = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const time = z.number().int().nonnegative();
const version = z
  .string()
  .min(1)
  .max(256)
  .refine(
    (value) =>
      !Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127),
  );
const fileSchema = z
  .object({
    fileId: id,
    storageId: id,
    name: z.string().min(1).max(255),
    contentType: z.string().min(1).max(255),
    size: z.number().int().nonnegative().max(1_000_000_000),
    sourceKey: z.string().max(512),
    objectKey: z.string().max(512).optional(),
    copyState: z.enum(["pending", "copying", "copied"]),
    copyAttemptId: uuid.optional(),
    copyDeadlineAt: time.optional(),
    destinationVersion: version.optional(),
    scanStatus: z.enum(["pending", "scanning", "clean", "skipped-too-large", "infected", "failed"]),
    scanAttemptId: uuid.optional(),
    scanHandle: opaque.optional(),
    receivedAt: z.string().refine((value) => Number.isFinite(Date.parse(value))),
    retainedUntil: time.optional(),
  })
  .strict();
const identity = {
  intentId: opaque,
  sourceId: id,
  accountId: opaque,
  attemptId: uuid,
  snapshotHash: hash,
};
export const transferFileClaimSchema = z.discriminatedUnion("state", [
  z
    .object({
      ...identity,
      state: z.literal("writing"),
      stageId: id,
      deadlineAt: time,
      files: z.array(fileSchema).min(1).max(100),
    })
    .strict(),
  z
    .object({
      ...identity,
      state: z.enum(["committed", "aborted"]),
      cleanupPending: z.boolean(),
      transfer: z.string().max(500_000).nullable(),
    })
    .strict(),
]);
export type TransferFileClaim = z.infer<typeof transferFileClaimSchema>;
export type TransferClaimFile = z.infer<typeof fileSchema>;
const grantSchema = z
  .object({
    created: z.boolean(),
    attempt: transferFileClaimSchema,
    file: fileSchema,
  })
  .strict();
const unavailable = () => new OwnedTransferError("storage_unavailable", 503);

function checked(value: unknown, intentId: string): TransferFileClaim | null {
  if (value === null) return null;
  const parsed = transferFileClaimSchema.safeParse(value);
  if (!parsed.success || parsed.data.intentId !== intentId) throw unavailable();
  if (parsed.data.state === "writing") {
    const files = parsed.data.files;
    if (
      new Set(files.map((file) => file.fileId)).size !== files.length ||
      new Set(files.map((file) => file.storageId)).size !== files.length
    )
      throw unavailable();
    for (const file of files) {
      if (
        Array.from(file.sourceKey).some((char) => char.charCodeAt(0) < 32) ||
        !/^sharemeatsack\/(?!owned\/|library\/)[A-Za-z0-9._-]{1,64}\/[A-Za-z0-9._-]{1,64}\/[^/]{1,80}$/.test(
          file.sourceKey,
        )
      )
        throw unavailable();
      if (
        file.objectKey !== undefined &&
        (!file.copyAttemptId ||
          file.objectKey !==
            `sharemeatsack/owned/${parsed.data.sourceId}/${file.storageId}/sealed/${file.copyAttemptId}`)
      )
        throw unavailable();
    }
  }
  return parsed.data;
}

export function createTransferFileClaimMetadata(metadata: LibraryMetadata) {
  async function call(operation: string, input: { intentId: string } & Record<string, unknown>) {
    return checked(await metadata.call(operation, input), input.intentId);
  }
  async function grant(
    operation: string,
    input: { intentId: string; fileId: string } & Record<string, unknown>,
  ) {
    const result = grantSchema.safeParse(await metadata.call(operation, input));
    if (!result.success) throw unavailable();
    const attempt = checked(result.data.attempt, input.intentId);
    if (
      !attempt ||
      attempt.state !== "writing" ||
      result.data.file.fileId !== input.fileId ||
      JSON.stringify(attempt.files.find((file) => file.fileId === input.fileId)) !==
        JSON.stringify(result.data.file)
    )
      throw unavailable();
    return { ...result.data, attempt };
  }
  return { call, grant };
}

/** Processes one file per invocation. Only a first native grant may write; replay observes the immutable target. */
export function createTransferFileClaimWorker(ports: {
  metadata: LibraryMetadata;
  objects: ObjectStore | null;
  scanner: Cleanroom | null;
  baseUrl: string;
  callbackUrl: string;
  now?: () => number;
  randomUUID?: () => string;
}) {
  const metadata = createTransferFileClaimMetadata(ports.metadata);
  const now = ports.now ?? Date.now;
  const attemptId = ports.randomUUID ?? randomUUID;
  async function current(intentId: string) {
    return metadata.call("getClaimAttempt", { intentId });
  }
  async function abort(intentId: string) {
    await metadata.call("abortClaimFiles", { intentId });
    return true;
  }
  async function observed(file: TransferClaimFile) {
    if (!ports.objects?.available() || !ports.objects.headVersion || !file.objectKey)
      throw unavailable();
    const head = await ports.objects.headVersion(file.objectKey);
    if (!head || head.size !== file.size) return null;
    return head;
  }
  async function apply(intentId: string, file: TransferClaimFile, verdict: CleanroomVerdict) {
    const head = await observed(file);
    if (!head || head.version !== file.destinationVersion || !file.scanAttemptId)
      return abort(intentId);
    await metadata.call("claimScanResult", {
      intentId,
      fileId: file.fileId,
      scanAttemptId: file.scanAttemptId,
      destinationVersion: file.destinationVersion,
      ...(file.scanHandle ? { scanHandle: file.scanHandle } : {}),
      status: scanStatusFromVerdict(verdict),
      ...(verdict.verdict === "infected"
        ? { reason: verdict.signature.slice(0, 500) }
        : verdict.verdict === "failed"
          ? { reason: verdict.reason.slice(0, 500) }
          : {}),
    });
    return true;
  }
  async function process(intentId: string): Promise<boolean> {
    if (!opaque.safeParse(intentId).success) return false;
    const claim = await current(intentId);
    if (!claim) return false;
    if (claim.state !== "writing") return true;
    if (
      claim.deadlineAt <= now() ||
      claim.files.some((file) => file.retainedUntil !== undefined && file.retainedUntil <= now())
    )
      return abort(intentId);
    if (!ports.objects?.available() || !ports.objects.headVersion || !ports.objects.copyVersion)
      throw unavailable();
    const file = claim.files.find(
      (item) => !["clean", "skipped-too-large"].includes(item.scanStatus),
    );
    if (!file) {
      await metadata.call("commitClaimFiles", { intentId });
      return true;
    }
    if (["infected", "failed"].includes(file.scanStatus)) return abort(intentId);
    if (file.copyState !== "copied") {
      const grant = await metadata.grant("beginClaimCopy", {
        intentId,
        fileId: file.fileId,
        copyAttemptId: attemptId(),
      });
      const target = grant.file;
      if (!target.objectKey || !target.copyAttemptId || target.copyDeadlineAt === undefined)
        throw unavailable();
      if (target.copyDeadlineAt <= now()) return abort(intentId);
      if (grant.created) {
        // Leave enough of the fixed grant for the provider's bounded 30-second COPY.
        if (now() + 30_000 > target.copyDeadlineAt) return abort(intentId);
        const source = await ports.objects.headVersion(target.sourceKey);
        if (!source || source.size !== target.size) return abort(intentId);
        if (now() + 30_000 > target.copyDeadlineAt) return abort(intentId);
        await ports.objects.copyVersion(target.sourceKey, target.objectKey, source);
      }
      const head = await observed(target);
      if (!head) return true; // An uncertain COPY is observed again; never issue a second writer.
      await metadata.call("finishClaimCopy", {
        intentId,
        fileId: target.fileId,
        copyAttemptId: target.copyAttemptId,
        observedBytes: head.size,
        destinationVersion: head.version,
      });
      return true;
    }
    if (!file.destinationVersion || !file.objectKey) throw unavailable();
    if (file.scanHandle) {
      if (!ports.scanner?.available()) throw unavailable();
      const result = await ports.scanner.poll(file.scanHandle);
      if (result && result.handle === file.scanHandle && result.verdict)
        return apply(intentId, file, result.verdict);
      return true;
    }
    const grant = await metadata.grant("beginClaimScan", {
      intentId,
      fileId: file.fileId,
      scanAttemptId: attemptId(),
    });
    const target = grant.file;
    if (!target.scanAttemptId || !target.objectKey || !target.destinationVersion)
      throw unavailable();
    const head = await observed(target);
    if (!head || head.version !== target.destinationVersion) return abort(intentId);
    if (target.size > SCAN_SIZE_CAP_BYTES)
      return apply(intentId, target, {
        verdict: "too-large",
        declaredSizeBytes: target.size,
        capBytes: SCAN_SIZE_CAP_BYTES,
      });
    if (!ports.scanner?.available()) throw unavailable();
    const signed = await ports.objects.presignGet({
      key: target.objectKey,
      filename: target.name,
      contentType: target.contentType,
      expiresInSeconds: SCAN_LINK_TTL_SECONDS,
    });
    const result = await ports.scanner.submit({
      url: new URL(signed.url, ports.baseUrl).href,
      callbackUrl: ports.callbackUrl,
      declaredSizeBytes: target.size,
      submissionKey: `claim:${claim.sourceId}:${target.storageId}:${target.scanAttemptId}`,
    });
    if (!opaque.safeParse(result.handle).success) throw unavailable();
    const recorded = await metadata.call("registerClaimScan", {
      intentId,
      fileId: target.fileId,
      scanAttemptId: target.scanAttemptId,
      scanHandle: result.handle,
      destinationVersion: target.destinationVersion,
    });
    if (!recorded || recorded.state !== "writing") return recorded !== null;
    const registered = recorded.files.find((entry) => entry.fileId === target.fileId);
    if (!registered || registered.scanHandle !== result.handle) throw unavailable();
    if (result.verdict) return apply(intentId, registered, result.verdict);
    return true;
  }
  return { process };
}
