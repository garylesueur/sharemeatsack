import { ownedWorkspaceRequest } from "@/lib/owned-workspace-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return ownedWorkspaceRequest(request, "send");
}
