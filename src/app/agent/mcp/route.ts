import { markdownResponse, mcpGuideMarkdown } from "@/lib/mcp-docs";

export function GET(): Response {
  return markdownResponse(mcpGuideMarkdown());
}
