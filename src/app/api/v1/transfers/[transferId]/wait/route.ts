import {
  getDefaultTransferService,
  jsonError,
  jsonServiceError,
  readTransferToken,
} from "@/lib/app-transfers";
import { isTransferServiceError } from "@/lib/transfers";

// Mirrors WAIT_FUNCTION_MAX_SECONDS in src/lib/schema.ts; a route segment
// config must be a literal, so it cannot import it. wait-budget.test.ts fails
// if they drift. A wait sits for WAIT_BUDGET_SECONDS, leaving room to answer
// inside this limit rather than being killed on the wire.
export const maxDuration = 60;

type RouteContext = {
  params: Promise<{ transferId: string }>;
};

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { transferId } = await context.params;
  let body: unknown = {};
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      body = await request.json();
    } catch {
      return jsonError(400, "invalid_json", "Body must be JSON");
    }
  }

  const seconds =
    body && typeof body === "object" && "seconds" in body
      ? (body as { seconds?: unknown }).seconds
      : undefined;

  const result = await getDefaultTransferService().wait({
    transferId,
    agentToken: readTransferToken(request),
    seconds: typeof seconds === "number" ? seconds : undefined,
  });
  if (isTransferServiceError(result)) {
    return jsonServiceError(result);
  }
  return Response.json(result);
}
