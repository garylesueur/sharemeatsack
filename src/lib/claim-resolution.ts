import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { claimBindingSchema, type ClaimIntentClient } from "./claim-intent-client";
import { boundedClaimBytes } from "./claim-body";

const resolutionSchema = claimBindingSchema
  .extend({
    product: z.literal("sharemeatsack"),
    outcome: z.enum(["committed", "aborted"]),
  })
  .strict();
export type SourceClaimState = "none" | "pending" | "committed" | "foreign";
type ResolutionSource = {
  inspectClaim(id: string, accountId: string, attemptId: string): Promise<SourceClaimState>;
  resolveClaim(
    id: string,
    accountId: string,
    attemptId: string,
    outcome: "committed" | "aborted",
  ): Promise<boolean>;
};
function reply(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", Vary: "claim-resolution-signature" },
  });
}
/** A signed callback is a prompt to re-read authority, never a caller assertion of commit. */
export async function claimResolutionRequest(
  request: Request,
  deps: {
    secret: string;
    intents: Pick<ClaimIntentClient, "get">;
    source: ResolutionSource;
    now?: () => number;
  },
) {
  let body: string;
  try {
    if (!request.body || Number(request.headers.get("content-length")) > 8192)
      return reply({ error: "invalid_request" }, 413);
    body = new TextDecoder().decode(await boundedClaimBytes(request.body, 8192));
  } catch {
    return reply({ error: "invalid_request" }, 400);
  }
  const signature = /^t=(\d{1,12}),v1=([a-f0-9]{64})$/.exec(
    request.headers.get("claim-resolution-signature") ?? "",
  );
  if (
    !deps.secret ||
    !signature ||
    Math.abs((deps.now?.() ?? Date.now()) - Number(signature[1]) * 1000) > 300000
  )
    return reply({ error: "unauthorised" }, 401);
  const expected = createHmac("sha256", deps.secret)
    .update(`${signature[1]}.claim-resolution.${body}`)
    .digest();
  if (!timingSafeEqual(expected, Buffer.from(signature[2], "hex")))
    return reply({ error: "unauthorised" }, 401);
  let selected: z.infer<typeof resolutionSchema>;
  try {
    selected = resolutionSchema.parse(JSON.parse(body));
  } catch {
    return reply({ error: "invalid_request" }, 400);
  }
  const { product: _product, outcome, ...binding } = selected;
  try {
    const receipt = await deps.intents.get(binding);
    if (!receipt || receipt.sourceResolved || receipt.state !== outcome)
      return reply({ error: "unavailable" }, 409);
    const state = await deps.source.inspectClaim(
      binding.sourceId,
      binding.accountId,
      binding.attemptId,
    );
    if (
      state === "foreign" ||
      (outcome === "committed" && state === "none") ||
      (outcome === "aborted" && state === "committed")
    )
      return reply({ error: "unavailable" }, 409);
    // An aborted attempt must install its durable source barrier even when no fence
    // was installed yet. A delayed begin then cannot strand the source after ack.
    if (
      !(await deps.source.resolveClaim(
        binding.sourceId,
        binding.accountId,
        binding.attemptId,
        outcome,
      ))
    )
      return reply({ error: "unavailable" }, 409);
    return reply({ ok: true, ...selected });
  } catch {
    return reply({ error: "storage_unavailable" }, 503);
  }
}
