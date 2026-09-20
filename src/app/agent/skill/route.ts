import { markdownResponse } from "@/lib/mcp-docs";
import { SHAREMEATSACK_SKILL_MARKDOWN } from "@/lib/sharemeatsack-skill";

export function GET(): Response {
  return markdownResponse(SHAREMEATSACK_SKILL_MARKDOWN);
}
