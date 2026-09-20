import {
  getDefaultTransferService,
  jsonServiceError,
  readTransferToken,
} from "@/lib/app-transfers";
import { isTransferServiceError } from "@/lib/transfers";

type RouteContext = {
  params: Promise<{ transferId: string; fileId: string }>;
};

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  const { transferId, fileId } = await context.params;
  const result = await getDefaultTransferService().removeFile({
    transferId,
    fileId,
    publicToken: readTransferToken(request),
  });
  if (isTransferServiceError(result)) {
    return jsonServiceError(result);
  }
  return new Response(null, { status: 204 });
}
