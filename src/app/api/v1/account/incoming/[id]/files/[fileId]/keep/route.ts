import { incomingRequest } from "@/lib/incoming-api";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; fileId: string }> };
export async function POST(request: Request, context: Context) {
  const { id, fileId } = await context.params;
  return incomingRequest(request, "keep", id, fileId);
}
export async function DELETE(request: Request, context: Context) {
  const { id, fileId } = await context.params;
  return incomingRequest(request, "abortKeep", id, fileId);
}
