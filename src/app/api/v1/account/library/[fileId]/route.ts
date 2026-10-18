import { libraryRequest } from "@/lib/library-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ fileId: string }> };
export async function GET(request: Request, context: Context) {
  return libraryRequest(request, "get", (await context.params).fileId);
}
export async function DELETE(request: Request, context: Context) {
  return libraryRequest(request, "remove", (await context.params).fileId);
}
