import { incomingRequest } from "@/lib/incoming-api";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return incomingRequest(request, "open", (await context.params).id);
}
