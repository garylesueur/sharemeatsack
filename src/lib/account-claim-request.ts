import { z } from "zod";
import type { AccountAuthority } from "./account-authority";
import { boundedClaimBytes } from "./claim-body";
import type { TransferClaimInput, TransferClaimResult } from "./transfer-claim-coordinator";
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const inputSchema = z
  .object({
    sourceId: identifier,
    proof: z.string().min(1).max(256),
    attemptId: z
      .string()
      .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
  })
  .strict();
const resultSchema = z.object({ status: z.literal("claimed"), id: identifier }).strict();
const safeErrors = new Set([
  "not_found",
  "claim_pending",
  "claim_not_completed",
  "claim_files_unsupported",
  "claim_receipt_unknown",
  "storage_capacity",
  "storage_unavailable",
]);
function reply(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store", Vary: "Authorization" },
  });
}
/** Verified bearer authority supplies the account; proof is a bounded private POST body only. */
export async function accountClaimRequest(
  request: Request,
  ports: {
    verify(request: Request): Promise<AccountAuthority>;
    claim(
      input: TransferClaimInput,
      authority: { accountId: string },
    ): Promise<TransferClaimResult>;
  },
) {
  try {
    const authority = await ports.verify(request);
    if (authority.outcome !== "accepted") return reply({ error: { code: "unauthorized" } }, 401);
    if (request.method !== "POST") return reply({ error: { code: "invalid_request" } }, 405);
    if (!request.body || Number(request.headers.get("content-length")) > 8192)
      return reply({ error: { code: "invalid_request" } }, 413);
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder().decode(await boundedClaimBytes(request.body, 8192)));
    } catch {
      return reply({ error: { code: "invalid_request" } }, 400);
    }
    const input = inputSchema.safeParse(value);
    if (!input.success) return reply({ error: { code: "invalid_request" } }, 400);
    const { proof, ...binding } = input.data;
    const result = await ports.claim(
      { ...binding, agentToken: proof },
      { accountId: authority.account },
    );
    const success = resultSchema.safeParse(result);
    if (success.success) return reply(success.data);
    if ("code" in result && safeErrors.has(result.code))
      return reply({ error: { code: result.code } }, result.status);
    return reply({ error: { code: "storage_unavailable" } }, 503);
  } catch {
    return reply({ error: { code: "storage_unavailable" } }, 503);
  }
}
