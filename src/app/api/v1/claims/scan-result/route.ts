import { getTransferFileClaimPorts } from "@/lib/app-transfer-claims";
import { transferClaimScanRequest } from "@/lib/transfer-claim-scan";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return transferClaimScanRequest(request, getTransferFileClaimPorts());
}
