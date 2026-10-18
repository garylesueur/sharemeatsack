import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installTestTransferStore } from "@/lib/app-transfers";
import { createMemoryTransferStore } from "@/lib/transfer-store";

vi.mock("mcp-handler", () => ({
  createMcpHandler: (register: (server: { tool: (...args: unknown[]) => void }) => void) => {
    let invoke: (args: unknown) => Promise<unknown>;
    register({
      tool: (...args) => {
        invoke = args[3] as typeof invoke;
      },
    });
    return async (request: Request) => {
      // Yield while another account's request enters the same shared handler.
      await Promise.resolve();
      return Response.json(await invoke(await request.json()));
    };
  },
}));

import { POST } from "./route";

const request = (token?: string) =>
  new Request("https://share.imeatsack.com/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ action: "request", title: token ?? "anonymous" }),
  });

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, options: RequestInit) => {
      const { token, product } = JSON.parse(String(options.body));
      return product === "sharemeatsack" && ["A", "B"].includes(token)
        ? Response.json({ account: token })
        : Response.json({}, { status: 401 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

it("B3 — MCP attributes concurrent creates per request and refuses supplied invalid authority", async () => {
  const store = createMemoryTransferStore();
  installTestTransferStore(store);
  const replies = await Promise.all([POST(request("A")), POST(request("B")), POST(request())]);
  await Promise.all(
    replies.map(async (response, index) => {
      expect(response.status).toBe(200);
      const result = JSON.parse((await response.json()).content[0].text);
      expect((await store.getById(result.transferId))?.ownerAccountId).toBe(
        ["A", "B", undefined][index],
      );
    }),
  );
  expect((await POST(request("invalid"))).status).toBe(401);
  expect((await store.listByOwner("invalid", { limit: 25 })).records).toEqual([]);
});
