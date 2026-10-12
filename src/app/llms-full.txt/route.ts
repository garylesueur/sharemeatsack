import { llmsFullTxt, discoveryTextResponse } from "@/lib/mcp-docs";

export function GET(): Response {
  return discoveryTextResponse(llmsFullTxt(), "text/plain");
}
