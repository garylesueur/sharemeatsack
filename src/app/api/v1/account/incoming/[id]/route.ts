import { incomingRequest } from "@/lib/incoming-api";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return incomingRequest(request, "get", (await context.params).id);
}
export async function DELETE(request: Request, context: Context) {
  return incomingRequest(request, "remove", (await context.params).id);
}
