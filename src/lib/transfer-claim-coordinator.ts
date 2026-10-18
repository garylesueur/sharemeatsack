/** Server-only. Current account authority and private source proof are separate inputs. */
import { createHash, timingSafeEqual } from "node:crypto";
import { getDefaultStore } from "./app-transfers";
import {
  claimIntentSchema,
  createClaimIntentClient,
  type ClaimBinding,
  type ClaimIntent,
  type ClaimIntentClient,
} from "./claim-intent-client";
import { createOwnedTransferMetadata } from "./owned-transfer-metadata";
import { OwnedTransferError } from "./owned-transfer-metadata";
import { createTransferFileClaimMetadata } from "./transfer-claim-files";
import {
  claimSourceSchema,
  claimUnavailable,
  createTransferClaimMetadata,
  type TransferClaimMetadata,
  type TransferClaimReceipt,
} from "./transfer-claim-metadata";
import type { TransferStore } from "./transfer-store";
import type { TransferServiceError } from "./transfers";
const identifier = /^[A-Za-z0-9_-]{1,128}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const hasControls = (value: string) => Array.from(value).some((char) => char.charCodeAt(0) < 32);
function proofMatches(actual: string, supplied: string) {
  return timingSafeEqual(Buffer.from(digest(actual), "hex"), Buffer.from(digest(supplied), "hex"));
}
export type TransferClaimInput = { sourceId: string; agentToken: string; attemptId: string };
export type TransferClaimResult = { status: "claimed"; id: string } | TransferServiceError;
const refused = (): TransferServiceError => ({
  status: 404,
  code: "not_found",
  message: "Transfer not found.",
});
const pending = (): TransferServiceError => ({
  status: 409,
  code: "claim_pending",
  message: "The claim is still being processed. Try again shortly.",
});
const unsupported = (): TransferServiceError => ({
  status: 409,
  code: "claim_files_unsupported",
  message: "Transfers containing files cannot be claimed yet.",
});
export function fileAdmission(value: { files?: unknown }): TransferServiceError | null {
  if (!hasFiles(value)) return null;
  if (!Array.isArray(value.files) || value.files.length > 100) return unsupported();
  const seen = new Set<string>();
  for (const entry of value.files) {
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof entry.id !== "string" ||
      !identifier.test(entry.id) ||
      seen.has(entry.id) ||
      entry.state !== "accepted" ||
      typeof entry.filename !== "string" ||
      !entry.filename ||
      entry.filename.length > 255 ||
      typeof entry.contentType !== "string" ||
      !entry.contentType ||
      entry.contentType.length > 255 ||
      typeof entry.key !== "string" ||
      hasControls(entry.key) ||
      !/^sharemeatsack\/(?!owned\/|library\/)[A-Za-z0-9._-]{1,64}\/[A-Za-z0-9._-]{1,64}\/[^/]{1,80}$/.test(
        entry.key,
      ) ||
      !Number.isSafeInteger(entry.size) ||
      entry.size < 0 ||
      entry.size > 1_000_000_000
    )
      return unsupported();
    seen.add(entry.id);
    if (typeof entry.receivedAt !== "string" || !Number.isFinite(Date.parse(entry.receivedAt)))
      return {
        status: 409,
        code: "claim_receipt_unknown",
        message: "The original file upload date is unavailable. The source has not been changed.",
      };
  }
  return null;
}
function admissionFailure(error: unknown): TransferServiceError {
  if (error instanceof OwnedTransferError) {
    if (error.code === "claim_provenance_unknown")
      return {
        status: 409,
        code: "claim_receipt_unknown",
        message: "The original file upload date is unavailable. The source has not been changed.",
      };
    if (["storage_allowance", "storage_capacity"].includes(error.code))
      return {
        status: 409,
        code: "storage_capacity",
        message: "Free storage and wait for cleanup before claiming these files.",
      };
    if (["ineligible_file", "expired", "claim_receipt_unknown"].includes(error.code))
      return {
        status: 409,
        code: "claim_not_completed",
        message: "The files are no longer eligible. The source has not been changed.",
      };
    if (error.code === "claim_files_unsupported") return unsupported();
  }
  return claimUnavailable();
}
function source(value: unknown, input: TransferClaimInput) {
  const result = claimSourceSchema.safeParse(value);
  return result.success &&
    result.data.id === input.sourceId &&
    result.data.ownerAccountId === undefined &&
    proofMatches(result.data.agentToken, input.agentToken)
    ? result.data
    : null;
}
function hasFiles(value: { files?: unknown }) {
  return value.files !== undefined && (!Array.isArray(value.files) || value.files.length > 0);
}
function matched(
  value: unknown,
  identity: Omit<ClaimBinding, "intentId">,
  binding?: ClaimBinding,
): ClaimIntent | null {
  const result = claimIntentSchema.safeParse(value);
  return result.success &&
    result.data.accountId === identity.accountId &&
    result.data.sourceId === identity.sourceId &&
    result.data.proofHash === identity.proofHash &&
    (!binding ||
      (result.data.intentId === binding.intentId && result.data.attemptId === binding.attemptId))
    ? result.data
    : null;
}
export function createTransferClaimCoordinator(
  options: {
    store?: TransferStore;
    metadata?: TransferClaimMetadata;
    intents?: ClaimIntentClient;
    now?: () => number;
    fileClaims?: ReturnType<typeof createTransferFileClaimMetadata>;
    processFiles?: (intentId: string) => Promise<boolean>;
  } = {},
) {
  return {
    async claim(
      input: TransferClaimInput,
      authority: { accountId: string },
    ): Promise<TransferClaimResult> {
      if (
        !identifier.test(input.sourceId) ||
        !uuid.test(input.attemptId) ||
        typeof input.agentToken !== "string" ||
        !input.agentToken ||
        Buffer.byteLength(input.agentToken) > 256 ||
        !/^[A-Za-z0-9_-]{1,256}$/.test(authority.accountId)
      )
        return refused();
      let store: TransferStore | undefined;
      let intents: ClaimIntentClient | undefined;
      let metadata: TransferClaimMetadata | undefined;
      let selected: ClaimBinding | undefined;
      let snapshotHash: string | undefined;
      async function ownedResult(): Promise<TransferClaimResult | null> {
        const owned = await metadata!.owned(input.sourceId);
        if (owned === "retired") return refused();
        if (!owned) return null;
        return owned.ownerAccountId === authority.accountId &&
          proofMatches(owned.agentToken, input.agentToken)
          ? { status: "claimed", id: owned.id }
          : refused();
      }
      async function settle(
        failure: TransferServiceError,
        receipt?: TransferClaimReceipt,
        cancelPrepared = false,
      ): Promise<TransferClaimResult> {
        if (!selected || !intents || !store?.inspectClaim || !store.resolveClaim) return failure;
        try {
          if (cancelPrepared) await intents.cancel(selected);
          const intent = matched(await intents.get(selected), selected, selected);
          if (!intent || intent.sourceResolved) return claimUnavailable();
          if (intent.state === "prepared" || intent.state === "started") return pending();
          if (intent.state === "aborted" && receipt) return claimUnavailable();
          // A null native receipt never establishes commitment or grants permission
          // to abort. A fresh definitive aborted intent is the abort authority.
          if (intent.state === "committed" && !receipt) {
            if (!snapshotHash || !metadata) return (await ownedResult()) ?? claimUnavailable();
            receipt =
              (await metadata.getClaim({
                accountId: selected.accountId,
                sourceId: selected.sourceId,
                snapshotHash,
              })) ?? undefined;
            if (!receipt) return claimUnavailable();
          }
          if (receipt && receipt.attemptId !== selected.attemptId) return claimUnavailable();
          const state = await store.inspectClaim(
            selected.sourceId,
            selected.accountId,
            selected.attemptId,
          );
          if (
            state === "foreign" ||
            (intent.state === "committed" && state === "none") ||
            (intent.state === "aborted" && state === "committed")
          )
            return claimUnavailable();
          // Abortion always installs the durable per-attempt barrier, including
          // when preparation was cancelled before any source fence was installed.
          if (
            !(await store.resolveClaim(
              selected.sourceId,
              selected.accountId,
              selected.attemptId,
              intent.state,
            ))
          )
            return claimUnavailable();
          // Only the durable signed recovery callback acknowledges/scrubs intent identity.
          return intent.state === "committed"
            ? receipt?.transfer === null
              ? refused()
              : { status: "claimed", id: selected.sourceId }
            : failure;
        } catch {
          return claimUnavailable();
        }
      }
      try {
        metadata = options.metadata ?? createTransferClaimMetadata(createOwnedTransferMetadata());
        const already = await ownedResult();
        if (already) return already;
        store = options.store ?? getDefaultStore();
        if (!store.beginClaim || !store.resolveClaim || !store.inspectClaim)
          return claimUnavailable();
        const initial = source(await store.getById(input.sourceId), input);
        if (!initial) return refused();
        const initialFailure = fileAdmission(initial);
        if (initialFailure) return initialFailure;
        const identity = {
          accountId: authority.accountId,
          sourceId: input.sourceId,
          attemptId: input.attemptId,
          proofHash: digest(input.agentToken),
        };
        intents =
          options.intents ??
          createClaimIntentClient({
            origin: process.env.LANYARD_URL ?? "https://meatsack.puregaz.com",
            secret: process.env.CLEANROOM_WEBHOOK_SECRET ?? "",
          });
        const prepared = matched(await intents.prepare(identity), identity);
        if (!prepared) return refused();
        selected = {
          accountId: prepared.accountId,
          sourceId: prepared.sourceId,
          attemptId: prepared.attemptId,
          proofHash: prepared.proofHash,
          intentId: prepared.intentId,
        };
        if (prepared.state === "committed") return (await ownedResult()) ?? claimUnavailable();
        if (prepared.state === "aborted") return settle(refused());
        if (prepared.sourceResolved || prepared.deadlineAt <= (options.now?.() ?? Date.now()))
          return settle(pending(), undefined, true);
        const frozen = await store.beginClaim(
          selected.sourceId,
          selected.accountId,
          selected.attemptId,
          input.agentToken,
        );
        if (!frozen) return settle(pending(), undefined, true);
        if (Buffer.byteLength(frozen.snapshot) > 500_000)
          return settle(claimUnavailable(), undefined, true);
        const value = source(JSON.parse(frozen.snapshot), input);
        if (!value) return settle(refused(), undefined, true);
        const frozenFailure = fileAdmission(value);
        if (frozenFailure) return settle(frozenFailure, undefined, true);
        snapshotHash = digest(frozen.snapshot);
        if (hasFiles(value)) {
          const files =
            options.fileClaims ?? createTransferFileClaimMetadata(createOwnedTransferMetadata());
          const started = await files.call("beginClaimFiles", {
            ...selected,
            snapshotHash,
            transfer: frozen.snapshot,
          });
          if (
            !started ||
            started.accountId !== selected.accountId ||
            started.sourceId !== selected.sourceId ||
            started.attemptId !== selected.attemptId ||
            started.snapshotHash !== snapshotHash
          )
            return settle(claimUnavailable(), undefined, true);
          // Native work is scheduled atomically with admission; the browser never owns file progress.
          if (started.state === "writing" && options.processFiles) {
            try {
              await options.processFiles(selected.intentId);
            } catch {
              /* The native job owns recovery; uncertainty never unlocks the source. */
            }
          }
          return settle(pending());
        }
        const result = await metadata.claimTransfer({
          ...selected,
          snapshotHash,
          transfer: frozen.snapshot,
        });
        return settle(claimUnavailable(), result);
      } catch (error) {
        // Cancelling a prepared intent is definitive; cancelling a started/committed
        // intent does not undo native admission. Fresh authority decides resolution.
        return settle(admissionFailure(error), undefined, true);
      }
    },
  };
}
