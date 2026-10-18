import { ownedWorkspaceRequest } from "@/lib/owned-workspace-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ recordId: string; fileId: string; action: string }> };
export async function POST(request: Request, context: Context) {
  const { recordId, fileId, action } = await context.params;
  if (!["keep", "preview", "download"].includes(action))
    return Response.json(
      { error: "not_found" },
      { status: 404, headers: { "Cache-Control": "private, no-store" } },
    );
  return ownedWorkspaceRequest(
    request,
    action as "keep" | "preview" | "download",
    recordId,
    fileId,
  );
}
export async function DELETE(request: Request, context: Context) {
  const { recordId, fileId, action } = await context.params;
  if (action !== "keep")
    return Response.json(
      { error: "not_found" },
      { status: 404, headers: { "Cache-Control": "private, no-store" } },
    );
  return ownedWorkspaceRequest(request, "abortKeep", recordId, fileId);
}
