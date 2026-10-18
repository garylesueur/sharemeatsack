import { homepageMarkdown, discoveryTextResponse } from "@/lib/mcp-docs";

export function GET(): Response {
  return discoveryTextResponse(homepageMarkdown(), "text/markdown");
}
