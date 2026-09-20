import {
  getDefaultTransferService,
  jsonServiceError,
  readTransferToken,
} from "@/lib/app-transfers";
import { isTransferServiceError } from "@/lib/transfers";

type RouteContext = {
  params: Promise<{ transferId: string }>;
};

async function status(request: Request, context: RouteContext): Promise<Response> {
  const { transferId } = await context.params;
  const result = await getDefaultTransferService().getForAgent({
    transferId,
    agentToken: readTransferToken(request),
  });
  if (isTransferServiceError(result)) {
    return jsonServiceError(result);
  }
  return Response.json(result);
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return status(request, context);
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return status(request, context);
}
