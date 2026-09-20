import {
  getDefaultTransferService,
  jsonServiceError,
  readTransferToken,
} from "@/lib/app-transfers";
import { isTransferServiceError } from "@/lib/transfers";

type RouteContext = {
  params: Promise<{ transferId: string; fileId: string }>;
};

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { transferId, fileId } = await context.params;
  const token = readTransferToken(request);
  const result = await getDefaultTransferService().refreshUploadUrl({
    transferId,
    fileId,
    publicToken: token,
    agentToken: token,
  });
  if (isTransferServiceError(result)) {
    return jsonServiceError(result);
  }
  return Response.json(result);
}
