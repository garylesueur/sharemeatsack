import { verifyAccountRequest, accountUnauthorized } from "@/lib/account-api";
import { getDefaultTransferService, jsonError, jsonServiceError } from "@/lib/app-transfers";
import { limitCreateFromRequest } from "@/lib/create-rate-limit";
import { isTransferServiceError } from "@/lib/transfers";

export async function POST(request: Request): Promise<Response> {
  const authority = await verifyAccountRequest(request);
  if (authority.outcome === "refused") return accountUnauthorized();

  const limited = await limitCreateFromRequest(request);
  if (!limited.ok) {
    return jsonError(429, "rate_limited", "Too many transfers from this address. Try again later.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid_json", "Body must be JSON");
  }

  const result = await getDefaultTransferService().create(
    body,
    authority.outcome === "accepted" ? authority.account : undefined,
  );
  if (isTransferServiceError(result)) {
    return jsonServiceError(result);
  }

  return Response.json(result, { status: 201 });
}
