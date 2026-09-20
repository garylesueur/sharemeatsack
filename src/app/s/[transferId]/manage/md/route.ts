import {
  getDefaultTransferService,
  jsonServiceError,
  readTransferToken,
} from "@/lib/app-transfers";
import { isTransferServiceError } from "@/lib/transfers";

type RouteContext = {
  params: Promise<{ transferId: string }>;
};

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { transferId } = await context.params;
  const result = await getDefaultTransferService().markdownForManage({
    transferId,
    agentToken: readTransferToken(request),
  });
  if (isTransferServiceError(result)) {
    return jsonServiceError(result);
  }
  return new Response(result, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
