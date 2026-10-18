import { AsyncLocalStorage } from "node:async_hooks";
import { verifyAccountRequest, accountUnauthorized } from "@/lib/account-api";
import { createMcpHandler } from "mcp-handler";
import {
  htmlDocumentResponse,
  markdownResponse,
  mcpGetDocumentKind,
  mcpGuideHtml,
  mcpGuideMarkdown,
} from "@/lib/mcp-docs";
import { getDefaultTransferService, apiErrorBody } from "@/lib/app-transfers";
import { SHAREMEATSACK_SKILL_MARKDOWN } from "@/lib/sharemeatsack-skill";
import { PRODUCT_NAME, PRODUCT_SENTENCE } from "@/lib/product";
import {
  SHAREMEATSACK_TOOL_NAME,
  createSharemeatsackTool,
  isSharemeatsackToolError,
  sharemeatsackToolInputShape,
} from "@/lib/sharemeatsack-tool";

// Mirrors WAIT_FUNCTION_MAX_SECONDS in src/lib/schema.ts; a route segment
// config must be a literal, so it cannot import it. wait-budget.test.ts fails
// if they drift. A wait sits for WAIT_BUDGET_SECONDS, leaving room to answer
// inside this limit rather than being killed on the wire.
export const maxDuration = 60;

const accountContext = new AsyncLocalStorage<{ account?: string }>();

const mcpHandler = createMcpHandler(
  (server) => {
    server.tool(
      SHAREMEATSACK_TOOL_NAME,
      `${PRODUCT_SENTENCE} Create a request or a send, read status, wait a bounded time, cancel, list files, or merge a secondary transfer into a primary using both private agent tokens. Same as the share.imeatsack.com HTTP API. This service does not send mail.`,
      sharemeatsackToolInputShape,
      async (args) => {
        const tool = createSharemeatsackTool(
          getDefaultTransferService(),
          accountContext.getStore()?.account,
        );
        const result = await tool.invoke(args);
        const text = JSON.stringify(
          isSharemeatsackToolError(result) ? apiErrorBody(result) : result,
        );
        if (isSharemeatsackToolError(result)) {
          return {
            content: [{ type: "text" as const, text }],
            isError: true,
          };
        }
        return {
          content: [{ type: "text" as const, text }],
        };
      },
    );
  },
  {
    serverInfo: {
      name: PRODUCT_NAME,
      version: "0.1.0",
    },
    instructions: SHAREMEATSACK_SKILL_MARKDOWN,
  },
  {
    disableSse: true,
    maxDuration: 60,
    verboseLogs: false,
  },
);

function withMcpCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept, Authorization, mcp-session-id, mcp-protocol-version, Last-Event-ID",
  );
  headers.set("Access-Control-Expose-Headers", "mcp-session-id, mcp-protocol-version");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function handleAuthorizedMcp(request: Request): Promise<Response> {
  const authority = await verifyAccountRequest(request);
  if (authority.outcome === "refused") return withMcpCors(accountUnauthorized());
  return accountContext.run(
    { account: authority.outcome === "accepted" ? authority.account : undefined },
    async () => withMcpCors(await mcpHandler(request)),
  );
}

export async function POST(request: Request): Promise<Response> {
  return handleAuthorizedMcp(request);
}

export async function GET(request: Request): Promise<Response> {
  const kind = mcpGetDocumentKind(request);
  if (kind === "markdown") {
    return markdownResponse(mcpGuideMarkdown());
  }
  if (kind === "html") {
    return htmlDocumentResponse(mcpGuideHtml());
  }
  return handleAuthorizedMcp(request);
}

export async function DELETE(request: Request): Promise<Response> {
  return handleAuthorizedMcp(request);
}

export async function OPTIONS(): Promise<Response> {
  return withMcpCors(new Response(null, { status: 204 }));
}
