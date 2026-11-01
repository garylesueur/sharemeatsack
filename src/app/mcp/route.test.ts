import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installTestTransferStore } from "@/lib/app-transfers";
import { resetLanyardVerifier } from "@/lib/lanyard";
import { createMemoryTransferStore, type TransferStore } from "@/lib/transfer-store";
import { POST } from "./route";

const fetchMock = vi.fn<typeof fetch>();
let store: TransferStore;

beforeEach(() => {
  store = createMemoryTransferStore();
  installTestTransferStore(store);
  resetLanyardVerifier();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("LANYARD_URL", "https://lanyard.test");
});

afterEach(() => {
  resetLanyardVerifier();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function call(args: Record<string, unknown>, authorization?: string) {
  const response = await POST(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(authorization ? { authorization } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "share.imeatsack.com", arguments: args },
      }),
    }),
  );
  const raw = await response.text();
  const line = raw.split("\n").find((entry) => entry.startsWith("data: "));
  const message = JSON.parse(line ? line.slice(6) : raw) as {
    result: { isError?: boolean; content: { text: string }[] };
  };
  return {
    isError: message.result.isError === true,
    body: JSON.parse(message.result.content[0]!.text) as Record<string, unknown>,
  };
}

describe("MCP create with a lanyard token", () => {
  it("attributes an accepted create, refuses a rejected one, and leaves other actions alone", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ account: "acct_simon" }));
    const created = await call({ action: "request", title: "Passport" }, "Bearer good");
    expect(created.isError).toBe(false);
    const transferId = created.body.transferId as string;
    expect((await store.getById(transferId))?.account).toBe("acct_simon");

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    const refused = await call({ action: "request", title: "Passport" }, "Bearer bad");
    expect(refused).toMatchObject({ isError: true, body: { error: { code: "unauthorized" } } });

    const agentToken = (await store.getById(transferId))!.agentToken;
    const calls = fetchMock.mock.calls.length;
    const polled = await call({ action: "status", transferId, agentToken }, "Bearer bad");
    expect(polled.isError).toBe(false);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });
});
