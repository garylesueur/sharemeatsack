import { accountClaimRequest } from "@/lib/account-claim-request";
import { verifyAccountRequest } from "@/lib/account-api";
import { createTransferClaimCoordinator } from "@/lib/transfer-claim-coordinator";

export async function POST(request: Request) {
  return accountClaimRequest(request, {
    verify: verifyAccountRequest,
    claim: (input, authority) => createTransferClaimCoordinator().claim(input, authority),
  });
}
