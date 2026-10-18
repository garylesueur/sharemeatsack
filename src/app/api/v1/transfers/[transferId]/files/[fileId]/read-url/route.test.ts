import { afterEach, describe, expect, it, vi } from "vitest";
import { installTestObjectStore, installTestTransferStore } from "@/lib/app-transfers";
import { createMemoryObjectStore, createR2ObjectStore } from "@/lib/object-store";
import { createMemoryTransferStore } from "@/lib/transfer-store";
import { POST } from "./route";

afterEach(() => {
  installTestObjectStore(null);
  vi.unstubAllGlobals();
});

async function fixture() {
  const store = createMemoryTransferStore();
  const objectStore = createMemoryObjectStore();
  installTestTransferStore(store);
  installTestObjectStore(objectStore);
  await objectStore.put("file", new Uint8Array([1, 2, 3]), "text/plain");
  await store.save({
    id: "send",
    kind: "send",
    title: "Files",
    status: "ready",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    publicToken: "public",
    agentToken: "private",
    files: [
      {
        id: "file",
        filename: "source.txt",
        contentType: "text/plain",
        size: 3,
        key: "file",
        state: "accepted",
        scanStatus: "clean",
      },
    ],
  });
  return { params: Promise.resolve({ transferId: "send", fileId: "file" }) };
}

const url = "http://localhost/api/v1/transfers/send/files/file/read-url";

describe("Viewing B8/B9 — HTTP read renewal", () => {
  it("returns retryable 503 for an R2 outage, then recovers without changing capability", async () => {
    const context = await fixture();
    installTestObjectStore(
      createR2ObjectStore({
        accountId: "test",
        accessKeyId: "test",
        secretAccessKey: "test",
        bucket: "test",
        endpoint: "https://test.r2.cloudflarestorage.com",
      }),
    );
    const request = () =>
      new Request(url, {
        method: "POST",
        headers: { Authorization: "Bearer public" },
        body: JSON.stringify({ purpose: "preview" }),
      });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 })),
    );
    expect((await POST(request(), context)).status).toBe(503);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { headers: { "content-length": "3" } })),
    );
    expect((await POST(request(), context)).status).toBe(200);
  });
  it("requires a bearer capability, returns only access metadata and disables caching", async () => {
    const context = await fixture();
    const response = await POST(
      new Request(url, {
        method: "POST",
        headers: { Authorization: "Bearer public", "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: "preview" }),
      }),
      context,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(Object.keys(await response.json()).toSorted()).toEqual(["expiresAt", "url"]);
    const refused = await POST(
      new Request(`${url}?token=public`, {
        method: "POST",
        body: JSON.stringify({ purpose: "preview" }),
      }),
      context,
    );
    expect(refused.status).toBe(404);
    expect(refused.headers.get("cache-control")).toBe("private, no-store");
  });

  it("refuses malformed purposes at the HTTP boundary without issuing access", async () => {
    const context = await fixture();
    await Promise.all(
      ["{", JSON.stringify({ purpose: "execute" })].map(async (body) => {
        const response = await POST(
          new Request(url, { method: "POST", headers: { Authorization: "Bearer public" }, body }),
          context,
        );
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ error: { code: "invalid_request" } });
        expect(response.headers.get("cache-control")).toBe("private, no-store");
      }),
    );
  });
});
