import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryTransferStore } from "./transfer-store";
import { createMemoryObjectStore } from "./object-store";
import { installTestObjectStore, installTestTransferStore } from "./app-transfers";
import { incomingRequest } from "./incoming-api";
import { POST as resolve } from "../app/api/v1/account/incoming/resolve/route";

const id = "34e4a8ed-30c3-4f09-a0e8-5ff5ed605c28";
const row = {
  id,
  accountId: "recipient",
  transferId: "send",
  publicToken: "public-proof",
  kind: "send",
  title: "Saved send",
  savedAt: 1,
  expiresAt: Date.parse("2100-01-01T00:00:00Z"),
};
function request(path = "/", account?: string, body?: string) {
  return new Request(`https://share.example${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(account ? { Authorization: `Bearer ${account}` } : {}),
      "Content-Type": "application/json",
    },
    ...(body !== undefined ? { body } : {}),
  });
}

describe("incoming HTTP account boundary", () => {
  const operations: { operation: string; accountId: string }[] = [];
  let outage = false;
  beforeEach(async () => {
    operations.length = 0;
    outage = false;
    vi.stubEnv("LANYARD_URL", "https://portal.example");
    vi.stubEnv("CLEANROOM_WEBHOOK_SECRET", "fixture-secret");
    vi.stubEnv("PUBLIC_BASE_URL", "https://share.example");
    const store = createMemoryTransferStore();
    await store.save({
      id: "send",
      publicToken: "public-proof",
      agentToken: "private-proof",
      kind: "send",
      title: "Saved send",
      status: "ready",
      createdAt: new Date().toISOString(),
      expiresAt: "2100-01-01T00:00:00Z",
      files: [],
    });
    installTestTransferStore(store);
    installTestObjectStore(createMemoryObjectStore());
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, input: RequestInit) => {
        const parsed = JSON.parse(String(input.body));
        if (String(url).endsWith("/verify"))
          return parsed.token === "ended"
            ? Response.json({}, { status: 401 })
            : Response.json({ account: parsed.token });
        if (outage) return Response.json({ error: "unavailable" }, { status: 503 });
        operations.push(parsed);
        if (parsed.operation === "listIncoming")
          return Response.json({
            records: parsed.accountId === "recipient" ? [row] : [],
            nextCursor: null,
          });
        if (parsed.operation === "getIncoming")
          return Response.json(parsed.accountId === "recipient" && parsed.id === id ? row : null);
        if (parsed.operation === "incomingKeptFiles")
          return Response.json({ keptFiles: {}, files: [] });
        if (parsed.operation === "removeIncoming")
          return Response.json(parsed.accountId === "recipient");
        throw new Error(`Unexpected operation: ${parsed.operation}`);
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it("verifies each request and gives neither absent nor ended sessions account-store access", async () => {
    await Promise.all(
      [undefined, "ended"].map(async (account) => {
        const response = await incomingRequest(request("/", account), "list");
        expect(response.status).toBe(401);
        expect(response.headers.get("Cache-Control")).toBe("private, no-store");
        expect(response.headers.get("Vary")).toBe("Authorization");
      }),
    );
    expect(operations).toEqual([]);
  });
  it("requires authentication for review and returns only safe read-only recipient metadata", async () => {
    const body = JSON.stringify({ url: "https://share.example/s/send?t=public-proof" });
    expect(
      (await resolve(request("/api/v1/account/incoming/resolve", undefined, body))).status,
    ).toBe(401);
    expect((await resolve(request("/api/v1/account/incoming/resolve", "ended", body))).status).toBe(
      401,
    );
    const response = await resolve(request("/api/v1/account/incoming/resolve", "recipient", body));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      transferId: "send",
      kind: "send",
      title: "Saved send",
      expiresAt: "2100-01-01T00:00:00Z",
      status: "ready",
      role: "download",
      available: true,
    });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Vary")).toBe("Authorization");
    expect(operations).toEqual([]);
  });
  it("review bounds bodies, refuses invalid URLs and recovers from unavailable links without writes", async () => {
    const url = "https://share.example/s/send?t=public-proof";
    expect(
      (await resolve(request("/", "recipient", JSON.stringify({ url, accountId: "other" }))))
        .status,
    ).toBe(400);
    expect((await resolve(request("/", "recipient", "x".repeat(2049)))).status).toBe(400);
    const invalid = await resolve(
      request(
        "/",
        "recipient",
        JSON.stringify({ url: "https://foreign.example/s/send?t=public-proof" }),
      ),
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "invalid_url" });
    const unavailable = await resolve(
      request(
        "/",
        "recipient",
        JSON.stringify({ url: "https://share.example/s/send?t=wrong-proof" }),
      ),
    );
    expect(unavailable.status).toBe(409);
    expect(await unavailable.json()).toEqual({ error: "source_unavailable" });
    const recovered = await resolve(request("/", "recipient", JSON.stringify({ url })));
    expect(recovered.status).toBe(200);
    expect(operations).toEqual([]);
  });
  it("uses only verified account identity for list/detail/remove and hides all private proof", async () => {
    const response = await incomingRequest(request("/?limit=50", "recipient"), "list");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ records: [{ id, role: "download", title: "Saved send" }] });
    expect(JSON.stringify(body)).not.toMatch(
      /public-proof|private-proof|accountId|publicToken|agentToken/,
    );
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Vary")).toBe("Authorization");
    expect((await incomingRequest(request("/", "other"), "get", id)).status).toBe(404);
    expect(await (await incomingRequest(request("/", "other"), "list")).json()).toEqual({
      records: [],
    });
    expect(await (await incomingRequest(request("/", "other"), "remove", id)).json()).toEqual({
      removed: true,
    });
    expect(
      operations.every((operation) => ["recipient", "other"].includes(operation.accountId)),
    ).toBe(true);
  });
  it("bounds pagination and rejects caller account/origin selectors", async () => {
    await Promise.all(
      [
        "limit=0",
        "limit=101",
        "limit=1.5",
        `cursor=${"x".repeat(4097)}`,
        "accountId=other",
        "origin=https://foreign.example",
      ].map(async (query) =>
        expect((await incomingRequest(request(`/?${query}`, "recipient"), "list")).status).toBe(
          400,
        ),
      ),
    );
    expect(operations).toEqual([]);
  });
  it("bounds streamed bodies and rejects unrecognized caller ownership or storage fields", async () => {
    await Promise.all(
      [
        "x".repeat(2049),
        "{",
        JSON.stringify({
          id,
          url: "https://share.example/s/send?t=public-proof",
          accountId: "other",
        }),
        JSON.stringify({ id, sourceKey: "sharemeatsack/private" }),
      ].map(async (body) => {
        expect((await incomingRequest(request("/", "recipient", body), "save")).status).toBe(400);
      }),
    );
    expect(operations).toEqual([]);
  });
  it("surfaces provider failure and rejects malformed identifiers", async () => {
    outage = true;
    const response = await incomingRequest(request("/", "recipient"), "list");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
    expect((await incomingRequest(request("/", "recipient"), "get", "private-token")).status).toBe(
      404,
    );
  });
});
