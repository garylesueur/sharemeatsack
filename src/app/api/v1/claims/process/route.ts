import { getTransferFileClaimPorts } from "@/lib/app-transfer-claims";
import { transferClaimProcessRequest } from "@/lib/transfer-claim-process";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return transferClaimProcessRequest(request, {
    secret: process.env.CLEANROOM_WEBHOOK_SECRET ?? "",
    process: getTransferFileClaimPorts().process,
  });
}
