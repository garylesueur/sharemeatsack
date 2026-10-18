import { getDefaultObjectStore } from "@/lib/app-transfers";
import { createOwnedTransferMetadata } from "@/lib/owned-transfer-metadata";
import { ownedTransferCleanupRequest } from "@/lib/owned-transfer-cleanup";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return ownedTransferCleanupRequest(request, {
    secret: process.env.CLEANROOM_WEBHOOK_SECRET ?? "",
    metadata: createOwnedTransferMetadata(),
    objects: getDefaultObjectStore(),
  });
}
