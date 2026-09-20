import { getDefaultTransferService, jsonServiceError } from "@/lib/app-transfers";
import { CLEANROOM_SIGNATURE_HEADER } from "@/lib/cleanroom";
import { isTransferServiceError } from "@/lib/transfers";

export async function POST(request: Request): Promise<Response> {
  const payload = await request.text();
  const result = await getDefaultTransferService().applyScanCallback({
    payload,
    signature: request.headers.get(CLEANROOM_SIGNATURE_HEADER),
  });
  if (isTransferServiceError(result)) {
    return jsonServiceError(result);
  }
  return Response.json(result);
}
