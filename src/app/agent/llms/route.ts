import { llmsTxt, plainTextResponse } from "@/lib/mcp-docs";

export function GET(): Response {
  return plainTextResponse(llmsTxt());
}
