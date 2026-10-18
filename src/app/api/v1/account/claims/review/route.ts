import { claimReviewRequest, createTransferClaimReview } from "@/lib/claim-review";
import { verifyAccountRequest } from "@/lib/account-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return claimReviewRequest(request, {
    verify: verifyAccountRequest,
    review: createTransferClaimReview(),
  });
}
