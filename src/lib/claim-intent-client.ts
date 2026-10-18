import { createHmac } from "node:crypto";
import { z } from "zod";
import { boundedClaimBytes } from "./claim-body";
import { OwnedTransferError } from "./owned-transfer-metadata";
const storageUnavailable = () => new OwnedTransferError("storage_unavailable", 503);

const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const identitySchema = z
  .object({
    accountId: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/),
    sourceId: identifier,
    attemptId: z
      .string()
      .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
    proofHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const claimBindingSchema = identitySchema.extend({ intentId: identifier }).strict();
export type ClaimIdentity = z.infer<typeof identitySchema>;
export type ClaimBinding = z.infer<typeof claimBindingSchema>;
export const claimIntentSchema = claimBindingSchema
  .extend({
    product: z.literal("sharemeatsack"),
    state: z.enum(["prepared", "started", "committed", "aborted"]),
    createdAt: z.number().int(),
    deadlineAt: z.number().int(),
    sourceResolved: z.boolean(),
  })
  .strict();
export type ClaimIntent = z.infer<typeof claimIntentSchema>;

/** Server-only. Fresh private proof is verified before preparation; only its hash travels here. */
export function createClaimIntentClient(options: {
  origin: string;
  secret: string;
  fetch?: typeof fetch;
  now?: () => number;
}) {
  const endpoint = new URL("/api/v1/claims/store", options.origin);
  if (
    endpoint.username ||
    endpoint.password ||
    (endpoint.protocol !== "https:" &&
      !(
        endpoint.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)
      ))
  )
    throw storageUnavailable();
  async function call(
    operation: "prepare" | "get" | "cancel",
    input: ClaimIdentity | ClaimBinding,
  ): Promise<ClaimIntent | null> {
    const checked = (operation === "prepare" ? identitySchema : claimBindingSchema).safeParse(
      input,
    );
    if (!checked.success || !options.secret) throw storageUnavailable();
    const body = JSON.stringify({ product: "sharemeatsack", operation, input: checked.data });
    const seconds = Math.floor((options.now?.() ?? Date.now()) / 1000);
    const signature = createHmac("sha256", options.secret)
      .update(`${seconds}.claim-store.${body}`)
      .digest("hex");
    try {
      const response = await (options.fetch ?? fetch)(endpoint, {
        method: "POST",
        body,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: {
          "Content-Type": "application/json",
          "claim-store-signature": `t=${seconds},v1=${signature}`,
        },
      });
      if (!response.ok || !response.body) throw storageUnavailable();
      const bytes = await boundedClaimBytes(response.body, 8192);
      const parsed = claimIntentSchema
        .nullable()
        .parse(JSON.parse(new TextDecoder().decode(bytes)));
      if (!parsed) return null;
      if (
        parsed.accountId !== input.accountId ||
        parsed.sourceId !== input.sourceId ||
        parsed.proofHash !== input.proofHash ||
        (operation !== "prepare" &&
          (parsed.intentId !== (input as ClaimBinding).intentId ||
            parsed.attemptId !== input.attemptId))
      )
        throw storageUnavailable();
      return parsed;
    } catch {
      throw storageUnavailable();
    }
  }
  return {
    prepare: (input: ClaimIdentity) => call("prepare", input),
    get: (input: ClaimBinding) => call("get", input),
    cancel: (input: ClaimBinding) => call("cancel", input),
  };
}
export type ClaimIntentClient = ReturnType<typeof createClaimIntentClient>;
