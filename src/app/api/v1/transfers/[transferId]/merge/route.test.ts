import { describe, expect, it } from "vitest";
import { installTestTransferStore } from "@/lib/app-transfers";
import { createMemoryTransferStore } from "@/lib/transfer-store";
import { POST } from "./route";

const url = "http://localhost/api/v1/transfers/primary/merge";
const context = { params: Promise.resolve({ transferId: "primary" }) };

async function fixture() {
  const store = createMemoryTransferStore();
  installTestTransferStore(store);
  for (const id of ["primary", "secondary"]) {
    await store.save({
      id,
      kind: "send",
      status: "ready",
      title: id,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      publicToken: `${id}-public`,
      agentToken: `${id}-private`,
      files: [
        {
          id: `${id}-file`,
          filename: "file.txt",
          contentType: "text/plain",
          size: 3,
          state: "accepted",
          scanStatus: "clean",
          key: `${id}/file`,
        },
      ],
    });
  }
  return store;
}

function request(
  token: string,
  body = JSON.stringify({
    secondaryTransferId: "secondary",
    secondaryAgentToken: "secondary-private",
  }),
) {
  return new Request(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body,
  });
}

describe("Agent B11 — HTTP merge boundary", () => {
  it("requires both private tokens and returns counts and the primary link", async () => {
    const store = await fixture();
    for (const invalid of [
      request("primary-public"),
      request(
        "primary-private",
        JSON.stringify({
          secondaryTransferId: "secondary",
          secondaryAgentToken: "secondary-public",
        }),
      ),
    ]) {
      const refused = await POST(invalid, context);
      expect(refused.status).toBe(404);
      expect(await refused.json()).toEqual({
        error: { code: "not_found", message: "Transfer not found" },
      });
    }
    const response = await POST(request("primary-private"), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      primaryTransferId: "primary",
      secondaryTransferId: "secondary",
      movedFileCount: 1,
      totalFileCount: 2,
      secondaryFileCount: 0,
      downloadUrl: expect.stringContaining("/s/primary?t=primary-public"),
    });
    expect((await store.getById("primary"))?.files).toHaveLength(2);
    expect((await store.getById("secondary"))?.files).toEqual([]);
  });

  it("rejects malformed bodies without changing ownership", async () => {
    const store = await fixture();
    for (const body of ["{", "{}", JSON.stringify({ secondaryTransferId: "secondary" })]) {
      const response = await POST(request("primary-private", body), context);
      expect(response.status).toBe(400);
    }
    expect((await store.getById("primary"))?.files).toHaveLength(1);
    expect((await store.getById("secondary"))?.files).toHaveLength(1);
  });
});
