import { getDefaultStore } from "@/lib/app-transfers";
import { createClaimIntentClient } from "@/lib/claim-intent-client";
import { claimResolutionRequest } from "@/lib/claim-resolution";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const secret = process.env.CLEANROOM_WEBHOOK_SECRET ?? "";
    const store = getDefaultStore();
    if (!secret || !store.inspectClaim || !store.resolveClaim)
      throw new Error("Claim resolution unavailable.");
    return claimResolutionRequest(request, {
      secret,
      intents: createClaimIntentClient({
        origin: process.env.LANYARD_URL ?? "https://meatsack.puregaz.com",
        secret,
      }),
      source: {
        inspectClaim: store.inspectClaim.bind(store),
        resolveClaim: store.resolveClaim.bind(store),
      },
    });
  } catch {
    return Response.json(
      { error: "storage_unavailable" },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
