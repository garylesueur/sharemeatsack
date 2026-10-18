import { describe, expect, it, vi } from "vitest";
import type { LibraryMetadata } from "./library-metadata";
import { OwnedTransferError } from "./owned-transfer-metadata";
import { createOwnedTransferStore } from "./owned-transfer-store";
import { createMemoryTransferStore, type Transfer, type TransferUpdate } from "./transfer-store";

function record(id: string, kind: Transfer["kind"] = "send"): Transfer {
  return {
    id,
    kind,
    ownerAccountId: "owner",
    createdAt: "2026-10-10T12:00:00Z",
    expiresAt: "2026-10-11T12:00:00Z",
    status: "ready",
    title: id,
    publicToken: `${id}-public`,
    agentToken: `${id}-private`,
    files: [],
  };
}
function fixture() {
  const durable = createMemoryTransferStore(),
    legacy = createMemoryTransferStore();
  const retired = new Set<string>();
  const metadata: LibraryMetadata = {
    async call(operation, args) {
      switch (operation) {
        case "save":
          await durable.save(JSON.parse(String(args.transfer)));
          return true;
        case "getById": {
          if (retired.has(String(args.id))) return { retired: true };
          const value = await durable.getById(String(args.id));
          return value ? JSON.stringify(value) : null;
        }
        case "compareAndSave":
          return durable.compareAndSave(
            (args.updates as { before: string; after: string }[]).map(({ before, after }) => ({
              before: JSON.parse(before),
              after: JSON.parse(after),
            })),
          );
        case "listByOwner": {
          const page = await durable.listByOwner(String(args.accountId), {
            limit: Number(args.limit),
            cursor: args.cursor ? String(args.cursor) : undefined,
            kind: args.kind as Transfer["kind"] | undefined,
          });
          return {
            records: page.records.map((value) => JSON.stringify(value)),
            nextCursor: page.nextCursor ?? null,
          };
        }
        case "delete":
          await durable.delete(String(args.id));
          return true;
        case "lookupScan":
          return durable.lookupScan(String(args.handle));
        case "indexScan":
          await durable.indexScan(
            String(args.handle),
            args.pointer as { transferId: string; fileId: string },
          );
          return true;
        default:
          throw new Error("Unexpected operation");
      }
    },
  };
  return {
    legacy,
    durable,
    metadata,
    retired,
    store: createOwnedTransferStore({ legacy, metadata }),
  };
}

describe("Workspace B2 — authoritative owned transfer routing", () => {
  it("keeps new owned history durable and never revives a stale Redis snapshot on refusal/outage", async () => {
    const { store, legacy, durable, metadata, retired } = fixture();
    const transfer = record("owned");
    await store.save(transfer);
    expect(await legacy.getById(transfer.id)).toBeNull();
    await legacy.save({ ...transfer, title: "Stale Redis snapshot" });
    expect((await store.getById(transfer.id))?.title).toBe("owned");
    const call = metadata.call;
    metadata.call = async () => {
      throw new OwnedTransferError("unavailable", 503);
    };
    await expect(store.getById(transfer.id)).rejects.toMatchObject({ status: 503 });
    metadata.call = call;
    await durable.delete(transfer.id);
    retired.add(transfer.id);
    expect(await store.getById(transfer.id)).toBeNull();
    await store.delete(transfer.id);
    expect((await legacy.getById(transfer.id))?.title).toBe("Stale Redis snapshot");
    expect((await store.listByOwner("owner", { limit: 25 })).records).toEqual([]);
  });

  it("keeps current file authority separate from canonical records and refuses malformed or unavailable authority", async () => {
    const { store, metadata, legacy, retired } = fixture();
    const owned = record("owned");
    await store.save(owned);
    await legacy.save(record("legacy"));
    const original = metadata.call;
    metadata.call = async (operation, args) =>
      operation === "fileAccess" ? { fileIds: ["eligible"] } : original(operation, args);
    expect(await store.fileAccess!(owned.id)).toEqual(["eligible"]);
    expect(await store.getById(owned.id)).toEqual(owned);
    expect(await store.fileAccess!("legacy")).toBeNull();
    retired.add(owned.id);
    expect(await store.fileAccess!(owned.id)).toEqual([]);
    retired.clear();
    metadata.call = async (operation, args) =>
      operation === "fileAccess" ? null : original(operation, args);
    await expect(store.fileAccess!(owned.id)).rejects.toMatchObject({ status: 503 });
    metadata.call = async () => {
      throw new OwnedTransferError("unavailable", 503);
    };
    await expect(store.fileAccess!("legacy")).rejects.toMatchObject({ status: 503 });
  });

  it("continues existing legacy ownership mutations without importing them and refuses mixed-store merge", async () => {
    const { store, legacy, durable } = fixture();
    const old = record("legacy"),
      fresh = record("fresh");
    await legacy.save(old);
    await store.save(fresh);
    expect(await store.compareAndSave([{ before: old, after: { ...old, title: "Changed" } }])).toBe(
      true,
    );
    expect((await legacy.getById(old.id))?.title).toBe("Changed");
    expect(await durable.getById(old.id)).toBeNull();
    const before = (await legacy.getById(old.id))!;
    expect(
      await store.compareAndSave([
        { before, after: { ...before, files: [] } },
        { before: fresh, after: { ...fresh, title: "Must not change" } },
      ]),
    ).toBe(false);
    expect((await durable.getById(fresh.id))?.title).toBe("fresh");
  });

  it("reads available kept copies only for the durable owner and rejects malformed associations", async () => {
    const { store, metadata, legacy, retired } = fixture();
    const owned = record("owned");
    await store.save(owned);
    await legacy.save(record("legacy"));
    const original = metadata.call;
    const id = "c4d0c40e-191a-422f-b3d6-fbed0bb25e25";
    metadata.call = async (operation, args) =>
      operation === "fileAccess"
        ? { fileIds: [], keptFiles: { received: id } }
        : original(operation, args);
    expect(await store.keptFiles!("owner", owned.id)).toEqual({ received: id });
    expect(await store.keptFiles!("other", owned.id)).toEqual({});
    expect(await store.keptFiles!("owner", "legacy")).toEqual({});
    retired.add(owned.id);
    expect(await store.keptFiles!("owner", owned.id)).toEqual({});
    retired.clear();
    metadata.call = async (operation, args) =>
      operation === "fileAccess"
        ? { fileIds: [], keptFiles: { received: "../../private" } }
        : original(operation, args);
    await expect(store.keptFiles!("owner", owned.id)).rejects.toMatchObject({ status: 503 });
  });

  it("preserves compare-and-save conflicts for competing durable updates and refuses malformed authority", async () => {
    const { store, metadata } = fixture();
    const before = record("race");
    await store.save(before);
    const choices: TransferUpdate[][] = ["One", "Two"].map((title) => [
      { before, after: { ...before, title } },
    ]);
    const results = await Promise.all(choices.map((updates) => store.compareAndSave(updates)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(["One", "Two"]).toContain((await store.getById(before.id))?.title);
    metadata.call = async () => "{broken";
    await expect(store.getById(before.id)).rejects.toMatchObject({ status: 503 });
    metadata.call = async () => false;
    await expect(store.save(record("refused"))).rejects.toMatchObject({ status: 503 });
  });

  it("paginates the selected kind across durable then legacy history without leaking another account", async () => {
    const { store, legacy } = fixture();
    await store.save(record("new-send"));
    await store.save(record("new-request", "request"));
    await store.save({ ...record("other-send"), ownerAccountId: "other" });
    await legacy.save(record("old-send"));
    await legacy.save(record("old-request", "request"));
    const first = await store.listByOwner("owner", { limit: 1, kind: "send" });
    const second = await store.listByOwner("owner", {
      limit: 1,
      kind: "send",
      cursor: first.nextCursor,
    });
    expect([...first.records, ...second.records].map((row) => row.id)).toEqual([
      "new-send",
      "old-send",
    ]);
    expect(second.nextCursor).toBeUndefined();
  });

  it("never falls back to a legacy scan pointer when its durable lookup fails", async () => {
    const { store, legacy, metadata } = fixture();
    await legacy.indexScan("handle", { transferId: "legacy", fileId: "file" });
    metadata.call = vi.fn(async () => {
      throw new OwnedTransferError("unavailable", 503);
    });
    await expect(store.lookupScan("handle")).rejects.toMatchObject({ status: 503 });
  });
});
