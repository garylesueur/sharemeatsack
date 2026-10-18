/* eslint-disable no-await-in-loop -- Sequential mock replies verify raw and decoded Redis claim results. */
import { expect, it, vi } from "vitest";
import { TRANSFER_READ_WINDOW_SECONDS } from "./schema";
import {
  INSPECT_TRANSFER_CLAIM_LUA,
  createMemoryTransferStore,
  createRedisTransferStore,
  type KvClient,
  type Transfer,
} from "./transfer-store";

it("B3 — Redis updates carry the extended record lifetime to its owner index after scan keys", async () => {
  const evalCommand = vi.fn<KvClient["eval"]>().mockResolvedValue(1);
  const kv: KvClient = {
    get: async () => null,
    set: async () => "OK",
    del: async () => 1,
    eval: evalCommand,
  };
  const now = new Date("2026-10-07T12:00:00Z");
  const before: Transfer = {
    id: "owned",
    ownerAccountId: "account/A",
    kind: "request",
    title: "Files",
    createdAt: now.toISOString(),
    expiresAt: "2026-10-08T12:00:00Z",
    status: "scanning",
    publicToken: "public",
    agentToken: "private",
    files: [
      {
        id: "file",
        filename: "notes.txt",
        contentType: "text/plain",
        size: 1,
        state: "accepted",
        scanHandle: "scan-handle",
        scanStatus: "scanning",
      },
    ],
  };
  const after: Transfer = { ...before, status: "complete", completedAt: "2026-10-09T12:00:00Z" };
  const store = createRedisTransferStore(kv, () => now);
  expect(await store.compareAndSave([{ before, after }])).toBe(true);
  const [, keys, arguments_] = evalCommand.mock.calls[0];
  expect(keys).toEqual([
    "sharemeatsack:transfer:owned",
    "sharemeatsack:scan:scan-handle",
    "sharemeatsack:owner:account%2FA",
    "sharemeatsack:claim:owned",
  ]);
  const updates = JSON.parse(arguments_[0]);
  const ownerIndexes = JSON.parse(arguments_[3]);
  const expectedTtl = 2 * 86_400 + TRANSFER_READ_WINDOW_SECONDS;
  expect(updates[0].ttl).toBe(expectedTtl);
  expect(ownerIndexes).toEqual([{ member: `${now.toISOString()}|owned`, ttl: expectedTtl }]);
  await expect(
    store.compareAndSave([{ before, after: { ...after, ownerAccountId: "other" } }]),
  ).rejects.toThrow("immutable");
});

function anonymous(id = "source"): Transfer {
  return {
    id,
    kind: "send",
    title: "Original",
    status: "ready",
    createdAt: "2026-10-07T12:00:00Z",
    expiresAt: "2026-10-08T12:00:00Z",
    publicToken: "public-only",
    agentToken: "private-proof",
    files: [
      {
        id: "file",
        filename: "notes.txt",
        contentType: "text/plain",
        size: 1,
        state: "accepted",
        scanHandle: "original-scan",
        scanStatus: "clean",
      },
    ],
  };
}

it("claim refuses public proof, missing/owned sources and competing accounts, with exactly one snapshot", async () => {
  const store = createMemoryTransferStore();
  const source = anonymous();
  await store.save(source);
  await store.save({ ...anonymous("owned"), ownerAccountId: "account-A" });
  expect(
    await store.beginClaim!(source.id, "account-A", "attempt-A", source.publicToken),
  ).toBeNull();
  expect(
    await store.beginClaim!("missing", "account-A", "attempt-A", source.agentToken),
  ).toBeNull();
  expect(await store.beginClaim!("owned", "account-A", "attempt-A", source.agentToken)).toBeNull();
  const [first, competing] = await Promise.all([
    store.beginClaim!(source.id, "account-A", "attempt-A", source.agentToken),
    store.beginClaim!(source.id, "account-B", "attempt-B", source.agentToken),
  ]);
  expect(first).toEqual({ snapshot: JSON.stringify(source) });
  expect(competing).toBeNull();
  expect(
    await store.beginClaim!(source.id, "account-A", "other-attempt", source.agentToken),
  ).toBeNull();
  expect(await store.beginClaim!(source.id, "account-A", "attempt-A", "wrong")).toBeNull();
  expect(await store.beginClaim!(source.id, "account-A", "attempt-A", source.agentToken)).toEqual(
    first,
  );
  expect(await store.listByOwner("account-A", { limit: 10 })).toEqual({
    records: [expect.objectContaining({ id: "owned" })],
  });
});

it("a pending fence rejects stale saves, deletes and the entire paired CAS while keeping scans readable", async () => {
  const store = createMemoryTransferStore();
  const source = anonymous();
  const secondary = anonymous("secondary");
  await store.save(source);
  await store.save(secondary);
  await store.indexScan("original-scan", { transferId: source.id, fileId: "file" });
  const claim = await store.beginClaim!(source.id, "account-A", "attempt-A", source.agentToken);
  source.title = "Stale reader mutated";
  expect(await store.getById(source.id)).toEqual(JSON.parse(claim!.snapshot));
  const pending = (await store.getById(source.id))!;
  pending.title = "Pending reader mutated";
  expect((await store.getById(source.id))!.title).toBe("Original");
  await expect(store.save(source)).rejects.toThrow("fenced");
  await expect(store.delete(source.id)).rejects.toThrow("fenced");
  expect(
    await store.compareAndSave([
      { before: secondary, after: { ...secondary, title: "Merged" } },
      {
        before: JSON.parse(claim!.snapshot),
        after: { ...JSON.parse(claim!.snapshot), title: "Merged" },
      },
    ]),
  ).toBe(false);
  expect((await store.getById(secondary.id))!.title).toBe("Original");
  expect(await store.lookupScan("original-scan")).toEqual({
    transferId: source.id,
    fileId: "file",
  });
});

it("commit retains an opaque anti-resurrection marker; only the bound coordinator can reconcile", async () => {
  const store = createMemoryTransferStore();
  const source = anonymous();
  await store.save(source);
  await store.beginClaim!(source.id, "account-A", "attempt-A", source.agentToken);
  expect(await store.resolveClaim!(source.id, "account-B", "attempt-A", "committed")).toBe(false);
  expect(await store.resolveClaim!(source.id, "account-A", "attempt-B", "aborted")).toBe(false);
  expect(await store.resolveClaim!(source.id, "account-A", "attempt-A", "committed")).toBe(true);
  expect(await store.resolveClaim!(source.id, "account-A", "attempt-A", "committed")).toBe(true);
  expect(await store.resolveClaim!(source.id, "account-A", "attempt-A", "aborted")).toBe(false);
  expect(await store.getById(source.id)).toBeNull();
  expect(
    await store.beginClaim!(source.id, "account-A", "attempt-A", source.agentToken),
  ).toBeNull();
  await expect(store.save(source)).rejects.toThrow("fenced");
  await expect(store.save({ ...source, ownerAccountId: "account-A" })).rejects.toThrow("fenced");
  await expect(store.delete(source.id)).rejects.toThrow("fenced");
  expect(await store.compareAndSave([{ before: source, after: source }])).toBe(false);
});

it("abort restores the captured source and original public expiry without admitting an owner change", async () => {
  const store = createMemoryTransferStore();
  const source = anonymous();
  await store.save(source);
  await store.beginClaim!(source.id, "account-A", "attempt-A", source.agentToken);
  expect(await store.resolveClaim!(source.id, "account-A", "attempt-A", "aborted")).toBe(true);
  expect(await store.getById(source.id)).toEqual(source);
  await store.save({ ...source, title: "Writable again" });
  await expect(store.save({ ...source, ownerAccountId: "account-A" })).rejects.toThrow("immutable");
  expect((await store.getById(source.id))!.expiresAt).toBe(source.expiresAt);
  expect(
    await store.beginClaim!(source.id, "account-B", "attempt-B", source.agentToken),
  ).not.toBeNull();
});

it("Redis claim replies survive Upstash JSON deserialization while preserving the exact snapshot string", async () => {
  const snapshot = JSON.stringify(anonymous());
  const evalCommand = vi
    .fn<KvClient["eval"]>()
    .mockResolvedValueOnce({ snapshot })
    .mockResolvedValueOnce(JSON.stringify({ snapshot }))
    .mockResolvedValueOnce({ record: snapshot })
    .mockResolvedValueOnce(JSON.stringify({ record: snapshot }))
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(1)
    .mockResolvedValueOnce(-1)
    .mockResolvedValueOnce(0);
  const store = createRedisTransferStore({
    get: async () => null,
    set: async () => "OK",
    del: async () => 1,
    eval: evalCommand,
  });
  expect(await store.beginClaim!("source", "account-A", "attempt-A", "private-proof")).toEqual({
    snapshot,
  });
  expect(await store.beginClaim!("source", "account-A", "attempt-A", "private-proof")).toEqual({
    snapshot,
  });
  expect(await store.getById("source")).toEqual(anonymous());
  expect(await store.getById("source")).toEqual(anonymous());
  expect(await store.getById("source")).toBeNull();
  expect(await store.resolveClaim!("source", "account-A", "attempt-A", "committed")).toBe(true);
  await expect(store.save(anonymous())).rejects.toThrow("fenced");
  await expect(store.delete("source")).rejects.toThrow("fenced");
  const [, keys, arguments_] = evalCommand.mock.calls[0];
  expect(keys).toEqual([
    "sharemeatsack:transfer:source",
    "sharemeatsack:claim:source",
    `sharemeatsack:claim-abort:source:${arguments_[0]}`,
  ]);
  expect(arguments_[0]).toMatch(/^[a-f0-9]{64}$/);
  expect(arguments_[0]).not.toContain("account-A");
});

function inspectionSource(): Transfer {
  return {
    id: "inspection",
    kind: "send",
    title: "Synthetic",
    createdAt: "2026-10-11T12:00:00Z",
    expiresAt: "2026-10-12T12:00:00Z",
    status: "ready",
    publicToken: "public",
    agentToken: "private",
  };
}
it("Share inspection exposes only matching source state", async () => {
  const store = createMemoryTransferStore(),
    source = inspectionSource();
  await store.save(source);
  expect(await store.inspectClaim!(source.id, "a", "old")).toBe("none");
  await store.beginClaim!(source.id, "a", "old", source.agentToken);
  expect(await store.inspectClaim!(source.id, "a", "old")).toBe("pending");
  expect(await store.inspectClaim!(source.id, "b", "old")).toBe("foreign");
  expect(await store.inspectClaim!(source.id, "", "old")).toBe("foreign");
  await store.resolveClaim!(source.id, "a", "old", "committed");
  expect(await store.inspectClaim!(source.id, "a", "old")).toBe("committed");
});
it("Share abort-before-fence bars delayed old work while a fresh claim remains available", async () => {
  const store = createMemoryTransferStore(),
    source = inspectionSource();
  await store.save(source);
  expect(await store.resolveClaim!(source.id, "a", "old", "committed")).toBe(false);
  expect(await store.resolveClaim!(source.id, "a", "old", "aborted")).toBe(true);
  expect(await store.resolveClaim!(source.id, "a", "old", "aborted")).toBe(true);
  expect(await store.beginClaim!(source.id, "a", "old", source.agentToken)).toBeNull();
  expect(await store.beginClaim!(source.id, "b", "fresh", source.agentToken)).not.toBeNull();
  expect(await store.beginClaim!(source.id, "a", "old", source.agentToken)).toBeNull();
  expect(await store.resolveClaim!(source.id, "a", "old", "aborted")).toBe(false);
  expect(await store.inspectClaim!(source.id, "b", "fresh")).toBe("pending");
});
it("Share matching abort cannot reinstall its old fence after a new committed handoff", async () => {
  const store = createMemoryTransferStore(),
    source = inspectionSource();
  await store.save(source);
  await store.beginClaim!(source.id, "a", "old", source.agentToken);
  await store.resolveClaim!(source.id, "a", "old", "aborted");
  await store.beginClaim!(source.id, "b", "fresh", source.agentToken);
  expect(await store.beginClaim!(source.id, "a", "old", source.agentToken)).toBeNull();
  await store.resolveClaim!(source.id, "b", "fresh", "committed");
  expect(await store.beginClaim!(source.id, "a", "old", source.agentToken)).toBeNull();
  expect(await store.getById(source.id)).toBeNull();
});
it("Share Redis validates raw/decoded inspection replies and uses the same opaque barrier key for abort/begin", async () => {
  const run = vi.fn<KvClient["eval"]>();
  const store = createRedisTransferStore({ eval: run } as unknown as KvClient);
  for (const state of ["none", "pending", "committed", "foreign"]) {
    for (const value of [{ state }, JSON.stringify({ state })]) {
      run.mockResolvedValueOnce(value);
      expect(await store.inspectClaim!("source", "a", "old")).toBe(state);
    }
  }
  expect(run.mock.calls[0][0]).toBe(INSPECT_TRANSFER_CLAIM_LUA);
  expect(run.mock.calls[0][1]).toEqual(["sharemeatsack:claim:source"]);
  run.mockResolvedValueOnce({ state: ["none"] });
  await expect(store.inspectClaim!("source", "a", "old")).rejects.toThrow(
    "Invalid claim inspection",
  );
  run.mockResolvedValueOnce({ snapshot: "private" });
  await expect(store.inspectClaim!("source", "a", "old")).rejects.toThrow(
    "Invalid claim inspection",
  );
  run.mockResolvedValueOnce(1);
  expect(await store.resolveClaim!("source", "a", "old", "aborted")).toBe(true);
  const aborted = run.mock.calls.at(-1)!;
  run.mockResolvedValueOnce(false);
  expect(await store.beginClaim!("source", "a", "old", "private")).toBeNull();
  expect(run.mock.calls.at(-1)![1][2]).toBe(aborted[1][2]);
  expect(aborted[1][2]).toMatch(/^sharemeatsack:claim-abort:source:[a-f0-9]{64}$/);
});
