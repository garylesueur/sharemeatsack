import { libraryRequest } from "@/lib/library-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return libraryRequest(request, "list");
}
export async function POST(request: Request) {
  return libraryRequest(request, "offer");
}
