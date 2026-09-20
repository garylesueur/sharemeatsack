import {
  getDefaultTransferService,
  jsonServiceError,
  readTransferToken,
} from "@/lib/app-transfers";
import { isTransferServiceError } from "@/lib/transfers";

export const maxDuration = 60;

type RouteContext = {
  params: Promise<{ transferId: string }>;
};

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { transferId } = await context.params;
  const token = readTransferToken(request);
  const result = await getDefaultTransferService().cancel({
    transferId,
    agentToken: token,
    publicToken: token,
  });
  if (isTransferServiceError(result)) {
    return jsonServiceError(result);
  }
  return Response.json(result);
}
