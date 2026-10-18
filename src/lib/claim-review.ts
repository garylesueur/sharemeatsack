import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { AccountAuthority } from "./account-authority";
import { boundedClaimBytes } from "./claim-body";
import { getDefaultStore } from "./app-transfers";
import type { TransferStore } from "./transfer-store";
import { fileAdmission } from "./transfer-claim-coordinator";
const inputSchema = z
  .object({
    sourceId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    proof: z.string().min(1).max(256),
    attemptId: z
      .string()
      .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
  })
  .strict();
const dateSchema = z.string().refine((value) => Number.isFinite(Date.parse(value)));
export const claimReviewSchema = z
  .object({
    status: z.literal("reviewed"),
    id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    title: z.string().trim().min(1).max(255),
    expiresAt: dateSchema,
    files: z.number().int().min(0).max(1000),
    retention: z.enum(["permanent", "original-file-deadlines"]),
    earliestRetainedUntil: dateSchema.optional(),
    alreadyOwned: z.boolean(),
  })
  .strict();
export type ClaimReview = z.infer<typeof claimReviewSchema>;
export type ClaimReviewInput = z.infer<typeof inputSchema>;
export class ClaimReviewError extends Error {
  constructor(
    public code: string,
    public status = 409,
  ) {
    super(code);
  }
}
function fail(code = "not_found", status = 404): never {
  throw new ClaimReviewError(code, status);
}

const proofMatches = (actual: string | undefined, offered: string) =>
  typeof actual === "string" &&
  timingSafeEqual(
    createHash("sha256").update(actual).digest(),
    createHash("sha256").update(offered).digest(),
  );
const reply = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", Vary: "Authorization" },
  });
/** Review reads source/proof authority only. It never prepares, fences, reserves or imports. */
export async function claimReviewRequest(
  request: Request,
  ports: {
    verify(request: Request): Promise<AccountAuthority>;
    review(input: ClaimReviewInput, accountId: string): Promise<ClaimReview>;
  },
) {
  try {
    const authority = await ports.verify(request);
    if (authority.outcome !== "accepted") return reply({ error: { code: "unauthorized" } }, 401);
    if (request.method !== "POST" || new URL(request.url).search)
      return reply({ error: { code: "invalid_request" } }, 400);
    let raw: unknown;
    try {
      if (!request.body) throw new Error();
      raw = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          await boundedClaimBytes(request.body, 8192),
        ),
      );
    } catch {
      return reply({ error: { code: "invalid_request" } }, 400);
    }
    const input = inputSchema.safeParse(raw);
    if (!input.success) return reply({ error: { code: "invalid_request" } }, 400);
    const result = claimReviewSchema.parse(await ports.review(input.data, authority.account));
    if (result.id !== input.data.sourceId) throw new Error("Wrong source review");
    return reply(result);
  } catch (error) {
    const safe = new Set([
      "not_found",
      "claim_unavailable",
      "claim_pending",
      "claim_receipt_unknown",
      "claim_not_completed",
    ]);
    return error instanceof ClaimReviewError && safe.has(error.code)
      ? reply({ error: { code: error.code } }, error.status)
      : reply({ error: { code: "storage_unavailable" } }, 503);
  }
}
export function createTransferClaimReview(
  store: Pick<TransferStore, "getById"> = getDefaultStore(),
  now = Date.now,
) {
  return async (input: ClaimReviewInput, accountId: string): Promise<ClaimReview> => {
    const source = await store.getById(input.sourceId);
    if (
      !source ||
      source.id !== input.sourceId ||
      !proofMatches(source.agentToken, input.proof) ||
      (source.ownerAccountId && source.ownerAccountId !== accountId)
    )
      fail();
    const owned = source.ownerAccountId === accountId;
    if (!owned) {
      const failure = fileAdmission(source);
      if (failure) fail(failure.code, failure.status);
    }
    const files = source.files ?? [];
    if (!owned && files.some((file) => !file.receivedAt || Date.parse(file.receivedAt) > now()))
      fail("claim_receipt_unknown", 409);
    if (
      files.some(
        (file) =>
          file.state !== "accepted" ||
          ["pending", "scanning"].includes(file.scanStatus ?? "pending"),
      )
    )
      fail("claim_pending", 409);
    const dates =
      source.kind === "request"
        ? files
            .filter((file) => !file.libraryFileId)
            .map(
              (file) =>
                file.retainedUntil ??
                (file.receivedAt
                  ? new Date(Date.parse(file.receivedAt) + 90 * 86400000).toISOString()
                  : ""),
            )
        : [];
    if (dates.some((date) => !Number.isFinite(Date.parse(date)) || Date.parse(date) <= now()))
      fail("claim_not_completed", 409);
    if (!Number.isFinite(Date.parse(source.expiresAt))) fail();
    return {
      status: "reviewed",
      id: source.id,
      title: source.title || "Earlier transfer",
      expiresAt: source.expiresAt,
      files: files.length,
      retention:
        source.kind === "request" && files.some((file) => !file.libraryFileId)
          ? "original-file-deadlines"
          : "permanent",
      ...(dates.length
        ? { earliestRetainedUntil: new Date(Math.min(...dates.map(Date.parse))).toISOString() }
        : {}),
      alreadyOwned: owned,
    };
  };
}
