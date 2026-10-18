import { incomingRequest } from "@/lib/incoming-api";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => incomingRequest(request, "list");
export const POST = (request: Request) => incomingRequest(request, "save");
