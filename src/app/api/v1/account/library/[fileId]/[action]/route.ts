import { libraryRequest } from "@/lib/library-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ fileId: string; action: string }> };
export async function POST(request: Request, context: Context) {
  const { fileId, action } = await context.params;
  if (action !== "complete" && action !== "retry" && action !== "preview" && action !== "download")
    return Response.json(
      { error: "not_found" },
      { status: 404, headers: { "cache-control": "private, no-store" } },
    );
  return libraryRequest(request, action, fileId);
}
