import { getDefaultTransferService, jsonError, jsonServiceError } from "@/lib/app-transfers";
import { isTransferServiceError } from "@/lib/transfers";

type RouteContext = {
  params: Promise<{ transferId: string; fileId: string }>;
};

function noStore(response: Response): Response {
  response.headers.set("cache-control", "private, no-store");
  return response;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { transferId, fileId } = await context.params;
  const header = request.headers.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) || undefined : undefined;
  let purpose: "preview" | "download" = "download";
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return noStore(jsonError(400, "invalid_request", "A read purpose is required"));
    }
    const offered = (body as { purpose?: unknown }).purpose;
    if (offered !== undefined && offered !== "preview" && offered !== "download") {
      return noStore(jsonError(400, "invalid_request", "Choose preview or download"));
    }
    purpose = offered ?? "download";
  } catch {
    return noStore(jsonError(400, "invalid_request", "The request body must be JSON"));
  }
  try {
    const result = await getDefaultTransferService().readFileUrl({
      transferId,
      fileId,
      token,
      purpose,
    });
    return noStore(
      isTransferServiceError(result) ? jsonServiceError(result) : Response.json(result),
    );
  } catch {
    return noStore(
      jsonError(503, "unavailable", "File access is temporarily unavailable. Try again."),
    );
  }
}
