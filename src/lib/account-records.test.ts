import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryObjectStore } from "./object-store";
import { createMemoryTransferStore } from "./transfer-store";
import { createTransferService, isTransferServiceError } from "./transfers";
import { createSharemeatsackTool } from "./sharemeatsack-tool";
import { installTestTransferStore } from "./app-transfers";
import { POST as create } from "../app/api/v1/transfers/route";
import { GET as list } from "../app/api/v1/account/records/route";
import { GET as detail } from "../app/api/v1/account/records/[recordId]/route";
import { POST as cancel } from "../app/api/v1/account/records/[recordId]/cancel/route";

vi.mock("./create-rate-limit", () => ({ limitCreateFromRequest: async () => ({ ok: true }) }));

// The route integration uses the actual verifier against a fake Lanyard server.
// Tokens are opaque here: only the verification response can attribute ownership.
function request(path: string, account?: string, body?: unknown) {
  return new Request(`https://share.imeatsack.com${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(account ? { Authorization: `Bearer ${account}` } : {}),
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("B3 — verified account transfer ownership", () => {
  const store = createMemoryTransferStore();
  beforeEach(() => {
    installTestTransferStore(store);
  });

  it("lists and manages only the verified account's records, without private proof", async () => {
    let ids = 0;
    let tokens = 0;
    const transfers = createTransferService({
      store,
      now: () => new Date("2026-10-07T12:00:00Z"),
      createId: () => `owned-${++ids}`,
      createToken: () =>
        ++tokens % 2 === 1 ? `public-capability-${ids}` : `private-secret-${ids}`,
      objectStore: createMemoryObjectStore(),
    });
    const first = await transfers.create(
      { title: "A", ownerAccountId: "B", metadata: { ownerAccountId: "B" } },
      "A",
    );
    const second = await createSharemeatsackTool(transfers, "B").invoke({
      action: "request",
      title: "B",
    });
    const legacy = await transfers.create({ title: "Anonymous", ownerAccountId: "A" });
    if (isTransferServiceError(first) || isTransferServiceError(legacy))
      throw new Error("create failed");
    expect(isTransferServiceError(second)).toBe(false);
    expect((await store.getById(first.transferId))?.ownerAccountId).toBe("A");
    expect((await store.getById(legacy.transferId))?.ownerAccountId).toBeUndefined();
    expect(
      (await transfers.listForAccount("A", { limit: 25 })).records.map(({ id }) => id),
    ).toEqual([first.transferId]);
    const own = await transfers.getForAccount("A", first.transferId);
    expect(JSON.stringify(own)).not.toContain("private-secret");
    expect(JSON.stringify(own)).not.toMatch(
      /agentToken|publicToken|manageUrl|pollUrl|callbackUrl|metadata/,
    );
    expect(await transfers.getForAccount("B", first.transferId)).toMatchObject({ status: 404 });
    expect(await transfers.cancelForAccount("B", first.transferId)).toMatchObject({ status: 404 });
    expect((await store.getById(first.transferId))?.status).toBe("open");
    expect(await transfers.cancelForAccount("A", first.transferId)).toMatchObject({
      status: "cancelled",
    });
    const send = await transfers.create(
      {
        action: "send",
        title: "Owned send",
        ownerAccountId: "B",
        files: [{ name: "notes.txt", size: 1 }],
      },
      "A",
    );
    if (isTransferServiceError(send)) throw new Error("send failed");
    expect((await store.getById(send.transferId))?.ownerAccountId).toBe("A");
    const existing = (await store.getById(first.transferId))!;
    await expect(store.save({ ...existing, ownerAccountId: "B" })).rejects.toThrow("immutable");
    await expect(
      store.compareAndSave([{ before: existing, after: { ...existing, ownerAccountId: "B" } }]),
    ).rejects.toThrow("immutable");
  });

  it("paginates within an owner index without repeating records or leaking another owner", async () => {
    const separate = createMemoryTransferStore();
    let ids = 0;
    const transfers = createTransferService({
      store: separate,
      now: () => new Date("2026-10-07T12:00:00Z"),
      createId: () => `page-${++ids}`,
      createToken: () => "secret",
    });
    await transfers.create({ title: "A1" }, "A");
    await transfers.create({ title: "B" }, "B");
    await transfers.create({ title: "A2" }, "A");
    const first = await transfers.listForAccount("A", { limit: 1 });
    const next = await transfers.listForAccount("A", { limit: 1, cursor: first.nextCursor });
    expect(first.records.map(({ title }) => title)).toEqual(["A2"]);
    expect(next.records.map(({ title }) => title)).toEqual(["A1"]);
    expect(next.nextCursor).toBeUndefined();
  });
});

describe("B3 — account HTTP boundaries", () => {
  let store = createMemoryTransferStore();
  beforeEach(() => {
    store = createMemoryTransferStore();
    installTestTransferStore(store);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, options: RequestInit) => {
        const { token, product } = JSON.parse(String(options.body));
        if (product !== "sharemeatsack" || !["A", "B"].includes(token))
          return Response.json({}, { status: 401 });
        return Response.json({ account: token });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("derives ownership from verification, isolates reads/cancel, and rejects supplied invalid credentials", async () => {
    const a = await create(
      request("/api/v1/transfers", "A", {
        title: "A transfer",
        ownerAccountId: "B",
        metadata: { ownerAccountId: "B" },
      }),
    );
    expect(a.status).toBe(201);
    const { transferId } = await a.json();
    expect((await store.getById(transferId))?.ownerAccountId).toBe("A");
    await create(request("/api/v1/transfers", "B", { title: "B transfer" }));
    const own = await list(request("/api/v1/account/records", "A"));
    expect(own.headers.get("cache-control")).toBe("private, no-store");
    expect((await own.json()).records.map((record: { title: string }) => record.title)).toEqual([
      "A transfer",
    ]);
    const context = { params: Promise.resolve({ recordId: transferId }) };
    const read = await detail(request(`/api/v1/account/records/${transferId}`, "A"), context);
    expect(read.status).toBe(200);
    expect(JSON.stringify(await read.json())).not.toMatch(
      /agentToken|publicToken|manageUrl|pollUrl/,
    );
    expect(
      (await detail(request(`/api/v1/account/records/${transferId}`, "B"), context)).status,
    ).toBe(404);
    expect(
      (await cancel(request(`/api/v1/account/records/${transferId}/cancel`, "B", {}), context))
        .status,
    ).toBe(404);
    expect((await store.getById(transferId))?.status).toBe("open");
    expect(
      (await cancel(request(`/api/v1/account/records/${transferId}/cancel`, "A", {}), context))
        .status,
    ).toBe(200);
    expect((await store.getById(transferId))?.status).toBe("cancelled");
    expect(
      (await create(request("/api/v1/transfers", "invalid", { title: "invalid" }))).status,
    ).toBe(401);
    expect((await list(request("/api/v1/account/records", "invalid"))).status).toBe(401);
    expect((await list(request("/api/v1/account/records"))).status).toBe(401);
    const anonymous = await create(
      request("/api/v1/transfers", undefined, { title: "legacy", ownerAccountId: "A" }),
    );
    expect(anonymous.status).toBe(201);
    expect(
      (await store.getById((await anonymous.json()).transferId))?.ownerAccountId,
    ).toBeUndefined();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect((await list(request("/api/v1/account/records", "A"))).status).toBe(401);
    expect((await create(request("/api/v1/transfers", "A", { title: "offline" }))).status).toBe(
      401,
    );
  });
});
