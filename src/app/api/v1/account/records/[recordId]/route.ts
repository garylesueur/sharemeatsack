import {
  accountUnauthorized,
  privateAccountResponse,
  verifyAccountRequest,
} from "@/lib/account-api";
import { getDefaultTransferService, jsonServiceError } from "@/lib/app-transfers";
import { isTransferServiceError } from "@/lib/transfers";

export async function GET(
  request: Request,
  context: { params: Promise<{ recordId: string }> },
): Promise<Response> {
  const authority = await verifyAccountRequest(request);
  if (authority.outcome !== "accepted") return accountUnauthorized();
  const { recordId } = await context.params;
  const result = await getDefaultTransferService().getForAccount(authority.account, recordId);
  return privateAccountResponse(
    isTransferServiceError(result) ? jsonServiceError(result) : Response.json(result),
  );
}
