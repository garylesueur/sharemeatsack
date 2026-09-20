import {
  getDefaultTransferService,
  jsonError,
  jsonServiceError,
  readTransferToken,
} from "@/lib/app-transfers";
import { isTransferServiceError } from "@/lib/transfers";

type RouteContext = {
  params: Promise<{ transferId: string }>;
};

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { transferId } = await context.params;
  const result = await getDefaultTransferService().listFiles({
    transferId,
    agentToken: readTransferToken(request),
  });
  if (isTransferServiceError(result)) {
    return jsonServiceError(result);
  }
  return Response.json(result);
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { transferId } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid_json", "Body must be JSON");
  }
  const result = await getDefaultTransferService().registerFiles({
    transferId,
    publicToken: readTransferToken(request),
    body,
  });
  if (isTransferServiceError(result)) {
    return jsonServiceError(result);
  }
  return Response.json(result, { status: 201 });
}
