import { incomingRequest } from "@/lib/incoming-api";
export const dynamic = "force-dynamic";
export const POST = (request: Request) => incomingRequest(request, "resolve");
