import {
  accountUnauthorized,
  privateAccountResponse,
  verifyAccountRequest,
} from "@/lib/account-api";
import { getDefaultTransferService, jsonError } from "@/lib/app-transfers";
import { OwnedTransferError } from "@/lib/owned-transfer-metadata";

export async function GET(request: Request): Promise<Response> {
  const authority = await verifyAccountRequest(request);
  if (authority.outcome !== "accepted") return accountUnauthorized();
  const search = new URL(request.url).searchParams;
  const limit = Number(search.get("limit") ?? "25");
  const cursor = search.get("cursor") ?? undefined;
  const kind = search.get("kind") ?? undefined;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    (cursor !== undefined && cursor.length > 4096) ||
    (kind !== undefined && kind !== "send" && kind !== "request")
  ) {
    return privateAccountResponse(jsonError(400, "invalid_page", "Invalid pagination"));
  }
  try {
    const result = await getDefaultTransferService().listForAccount(authority.account, {
      limit,
      cursor,
      kind,
    });
    return privateAccountResponse(Response.json(result));
  } catch (error) {
    return privateAccountResponse(
      error instanceof OwnedTransferError
        ? jsonError(error.status, error.code, "The transfer list could not be loaded")
        : jsonError(503, "unavailable", "The transfer list could not be loaded"),
    );
  }
}
