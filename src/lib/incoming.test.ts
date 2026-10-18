import { describe, expect, it, vi } from "vitest";
import { createIncomingService, parseIncomingUrl } from "./incoming";
import { createMemoryObjectStore } from "./object-store";
import { OwnedTransferError } from "./owned-transfer-metadata";
import { createMemoryTransferStore, type Transfer } from "./transfer-store";
import { createTransferService } from "./transfers";
import type { LibraryFile } from "./library-metadata";

const id = "34e4a8ed-30c3-4f09-a0e8-5ff5ed605c28";
const copyId = "ec1a015e-5c3d-45b0-a815-821976f6e1e3";
const attemptId = "0ef37717-3c79-4db4-8ba9-fbeaa58a3d24";
const origin = "https://share.example";
const now = Date.parse("2026-10-11T12:00:00Z");
const sourceKey = "sharemeatsack/owned/send/source/sealed/source-attempt";
async function fixture(
  options: { kind?: "request" | "send"; legacy?: boolean; blocked?: boolean } = {},
) {
  const store = createMemoryTransferStore();
  const objects = createMemoryObjectStore();
  const transfer: Transfer = {
    id: "send",
    kind: options.kind ?? "send",
    title: "Source title",
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
    status: options.kind === "request" ? "open" : "ready",
    publicToken: "recipient-proof",
    agentToken: "private-owner-proof",
    files: [
      {
        id: "source",
        filename: "source.txt",
        contentType: "text/plain",
        size: 4,
        key: sourceKey,
        state: "accepted",
        scanStatus: options.blocked ? "infected" : "clean",
      },
    ],
  };
  await store.save(transfer);
  await objects.put(sourceKey, new TextEncoder().encode("safe"), "text/plain");
  store.fileAccess = vi.fn(async () => (options.legacy ? null : ["source"]));
  let saved: Record<string, unknown> | null = null;
  let associations: { keptFiles: Record<string, string>; files: Record<string, unknown>[] } = {
    keptFiles: {},
    files: [],
  };
  let failure: Error | null = null;
  const target: LibraryFile = {
    id: copyId,
    accountId: "recipient",
    name: "source.txt",
    contentType: "text/plain",
    size: 4,
    uploadKey: `sharemeatsack/library/${copyId}/upload`,
    objectKey: `sharemeatsack/library/${copyId}/sealed/${attemptId}`,
    createdAt: now,
    uploadExpiresAt: now,
    visible: false,
    state: "sealing",
    scanAttemptId: attemptId,
    scanStatus: "clean",
    references: [],
  };
  const metadata = {
    call: vi.fn(async (operation: string, args: Record<string, unknown>): Promise<unknown> => {
      if (failure) throw failure;
      if (operation === "getIncoming") return saved;
      if (operation === "saveIncoming") {
        saved = { ...args, savedAt: now };
        return saved;
      }
      if (operation === "listIncoming") return { records: saved ? [saved] : [], nextCursor: null };
      if (operation === "incomingKeptFiles") return associations;
      if (operation === "removeIncoming") {
        saved = null;
        return true;
      }
      if (operation === "beginIncomingKeep")
        return { file: { ...target }, sourceKey, status: target.visible ? "kept" : "copying" };
      if (operation === "commitIncomingKeep") {
        if (transfer.status !== "ready") return null;
        target.visible = true;
        target.state = "available";
        associations = {
          keptFiles: { source: copyId },
          files: [
            {
              id: "source",
              keptLibraryId: copyId,
              name: target.name,
              type: target.contentType,
              size: target.size,
              scanStatus: target.scanStatus,
            },
          ],
        };
        return { ...target };
      }
      if (operation === "abortIncomingKeep")
        return { file: { ...target }, status: target.visible ? "kept" : "cleaning" };
      throw new Error("Unexpected metadata operation");
    }),
  };
  const service = createIncomingService({
    accountId: "recipient",
    store,
    objects,
    metadata,
    origins: [origin],
    transfers: createTransferService({
      store,
      objectStore: objects,
      scanner: null,
      now: () => new Date(now),
      createId: () => "unused",
      createToken: () => "unused",
    }),
  });
  return {
    service,
    metadata,
    objects,
    store,
    transfer,
    target,
    saved: () => saved,
    setFailure: (error: Error) => {
      failure = error;
    },
    setSaved: (row: Record<string, unknown>) => {
      saved = row;
    },
    save: () => service.save({ id, url: `${origin}/s/send?t=recipient-proof` }),
  };
}

describe("incoming recipient authority", () => {
  it("reviews title and current recipient role without saving, refreshing scans or exposing request receipts", async () => {
    const f = await fixture({ kind: "request" });
    const before = structuredClone(f.transfer);
    const save = vi.spyOn(f.store, "save");
    const compareAndSave = vi.spyOn(f.store, "compareAndSave");
    expect(await f.service.resolve({ url: `${origin}/s/send?t=recipient-proof` })).toEqual({
      transferId: "send",
      kind: "request",
      title: "Source title",
      expiresAt: before.expiresAt,
      status: "open",
      role: "upload",
      available: true,
    });
    expect(f.metadata.call).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(compareAndSave).not.toHaveBeenCalled();
    expect(f.transfer).toEqual(before);
    expect(f.saved()).toBeNull();
  });
  it("reviews sends using fresh authority and refuses invalid or ended links with retry recovery", async () => {
    const f = await fixture();
    const input = { url: `${origin}/s/send?t=recipient-proof` };
    await expect(
      f.service.resolve({ url: "https://foreign.example/s/send?t=recipient-proof" }),
    ).rejects.toMatchObject({ code: "invalid_url", status: 400 });
    expect(await f.service.resolve(input)).toMatchObject({ role: "download", available: true });
    f.transfer.status = "cancelled";
    await expect(f.service.resolve(input)).rejects.toMatchObject({
      code: "source_unavailable",
      status: 409,
    });
    f.transfer.status = "ready";
    f.transfer.publicToken = "replaced-proof";
    await expect(f.service.resolve(input)).rejects.toMatchObject({ code: "source_unavailable" });
    expect(await f.service.resolve({ url: `${origin}/s/send?t=replaced-proof` })).toMatchObject({
      role: "download",
      available: true,
    });
    f.transfer.expiresAt = new Date(now).toISOString();
    await expect(
      f.service.resolve({ url: `${origin}/s/send?t=replaced-proof` }),
    ).rejects.toMatchObject({ code: "source_unavailable" });
    expect(f.metadata.call).not.toHaveBeenCalled();
  });
  it("accepts only bounded canonical recipient URLs on configured product origins", () => {
    expect(parseIncomingUrl(`${origin}/s/send?t=recipient-proof`, [origin])).toMatchObject({
      transferId: "send",
      publicToken: "recipient-proof",
    });
    for (const url of [
      "https://foreign.example/s/send?t=recipient-proof",
      `${origin}/s/send/manage?k=private`,
      `${origin}/s/send?t=recipient-proof&viewer=list`,
      `${origin}/s/send?t=recipient-proof&t=duplicate`,
      `${origin}/s/send?t=recipient-proof#private`,
      `${origin}/s/send?token=recipient-proof`,
      `${origin}/s/send?t=%72ecipient-proof`,
      `${origin}/s/send/?t=recipient-proof`,
      "https://user:pass@share.example/s/send?t=recipient-proof",
      `${origin}/s/send?t=${"x".repeat(257)}`,
    ])
      expect(() => parseIncomingUrl(url, [origin])).toThrow("invalid_url");
  });
  it("saves one metadata reference without byte copies, ownership or retention mutation", async () => {
    const f = await fixture();
    const before = structuredClone(f.transfer);
    const copy = vi.spyOn(f.objects, "copy");
    const first = await f.save();
    expect(first).toMatchObject({
      id,
      role: "download",
      available: true,
      canKeep: true,
      files: [{ id: "source", canRead: true, canKeep: true }],
    });
    expect(await f.save()).toEqual(first);
    expect(f.metadata.call.mock.calls.filter(([op]) => op === "saveIncoming")).toHaveLength(1);
    expect(f.metadata.call).toHaveBeenCalledWith("saveIncoming", {
      accountId: "recipient",
      id,
      transferId: "send",
      publicToken: "recipient-proof",
      title: "Source title",
      kind: "send",
      expiresAt: now + 60_000,
    });
    expect(copy).not.toHaveBeenCalled();
    expect(f.transfer).toEqual(before);
    expect(JSON.stringify(first)).not.toMatch(
      /publicToken|agentToken|accountId|objectKey|uploadKey|downloadUrl|recipient-proof|private-owner-proof/,
    );
  });
  it("never reveals upload request receipts or file counts and stops open when upload closes", async () => {
    const f = await fixture({ kind: "request" });
    expect(await f.save()).toMatchObject({
      kind: "request",
      role: "upload",
      canKeep: false,
      files: [],
    });
    expect(f.metadata.call.mock.calls.some(([op]) => op === "incomingKeptFiles")).toBe(false);
    expect(await f.service.open(id)).toEqual({ url: `${origin}/s/send?t=recipient-proof` });
    f.transfer.status = "complete";
    expect(await f.service.get(id)).toMatchObject({ available: false, files: [], canKeep: false });
    await expect(f.service.open(id)).rejects.toMatchObject({ code: "source_unavailable" });
  });
  it("preserves unavailable labels after revocation and reconciles an uncertain successful save", async () => {
    const f = await fixture();
    await f.save();
    f.transfer.publicToken = "replacement-proof";
    expect(await f.save()).toMatchObject({
      title: "Source title",
      status: "unavailable",
      available: false,
      files: [],
    });
    await expect(f.service.open(id)).rejects.toMatchObject({ code: "source_unavailable" });
    expect(f.metadata.call.mock.calls.filter(([op]) => op === "saveIncoming")).toHaveLength(1);
  });
  it("refuses new saves when recipient access is unavailable", async () => {
    const f = await fixture();
    f.transfer.status = "cancelled";
    await expect(f.save()).rejects.toMatchObject({ code: "source_unavailable" });
    expect(f.saved()).toBeNull();
  });
  it("uses exact public eligibility and labels legacy copies unavailable", async () => {
    const blocked = await fixture({ blocked: true });
    expect(await blocked.save()).toMatchObject({ canKeep: false, files: [] });
    const legacy = await fixture({ legacy: true });
    expect(await legacy.save()).toMatchObject({
      available: true,
      canKeep: false,
      keepUnavailableReason: "legacy_source",
      files: [{ canRead: true, canKeep: false }],
    });
  });
  it("refuses a foreign saved row and surfaces infrastructure failure instead of an empty view", async () => {
    const f = await fixture();
    await f.save();
    f.setSaved({ ...f.saved()!, accountId: "other" });
    await expect(f.service.get(id)).rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(f.service.list({ limit: 50, cursor: null })).rejects.toMatchObject({
      code: "not_found",
    });
    f.setFailure(new OwnedTransferError("unavailable", 503));
    await expect(f.service.list({ limit: 50, cursor: null })).rejects.toMatchObject({
      code: "unavailable",
    });
  });
});

describe("incoming independent keeping", () => {
  it("copies sealed bytes inside storage, checks HEAD, then commits with current metadata authority", async () => {
    const f = await fixture();
    await f.save();
    expect(await f.service.keep(id, "source", { id: copyId })).toMatchObject({
      status: "kept",
      file: { id: copyId, state: "available" },
    });
    expect(f.metadata.call).toHaveBeenCalledWith("commitIncomingKeep", {
      accountId: "recipient",
      incomingId: id,
      fileId: "source",
      id: copyId,
      attemptId,
      observedBytes: 4,
    });
    f.transfer.status = "expired";
    await f.objects.delete(sourceKey);
    expect(await f.service.get(id)).toMatchObject({
      available: false,
      files: [{ id: "source", keptLibraryId: copyId, canRead: false, canKeep: false }],
    });
    const copying = vi.spyOn(f.objects, "copy");
    expect(await f.service.keep(id, "source", { id: copyId })).toMatchObject({ status: "kept" });
    expect(copying).not.toHaveBeenCalled();
    expect(new TextDecoder().decode((await f.objects.get(f.target.objectKey!))!.body)).toBe("safe");
  });
  it("accepts only server-selected sealed library or owned source keys", async () => {
    const f = await fixture();
    const call = f.metadata.call;
    const original = call.getMockImplementation()!;
    const libraryKey = "sharemeatsack/library/source-library/sealed/source-attempt";
    await f.objects.put(libraryKey, new TextEncoder().encode("safe"), "text/plain");
    call.mockImplementation(async (op, args) =>
      op === "beginIncomingKeep"
        ? { file: { ...f.target }, sourceKey: libraryKey, status: "copying" }
        : original(op, args),
    );
    expect(await f.service.keep(id, "source", { id: copyId })).toMatchObject({ status: "kept" });
    const rejected = await fixture();
    rejected.metadata.call.mockResolvedValue({
      file: { ...rejected.target },
      sourceKey: "sharemeatsack/owned/send/source/upload",
      status: "copying",
    });
    const copy = vi.spyOn(rejected.objects, "copy");
    await expect(rejected.service.keep(id, "source", { id: copyId })).rejects.toMatchObject({
      code: "unavailable",
    });
    expect(copy).not.toHaveBeenCalled();
  });
  it("publishes no available copy when source authority ends after bytes finish copying", async () => {
    const f = await fixture();
    const copy = f.objects.copy.bind(f.objects);
    vi.spyOn(f.objects, "copy").mockImplementation(async (source, target) => {
      await copy(source, target);
      f.transfer.status = "cancelled";
    });
    await expect(f.service.keep(id, "source", { id: copyId })).rejects.toMatchObject({
      code: "file_unavailable",
    });
    expect(f.target.visible).toBe(false);
    expect(await f.objects.head(f.target.objectKey!)).toEqual({ size: 4 });
  });
  it("retains uncertain storage failures for retry and aborts a wrong size before publication", async () => {
    const f = await fixture();
    await f.objects.delete(sourceKey);
    await expect(f.service.keep(id, "source", { id: copyId })).rejects.toThrow();
    expect(f.metadata.call.mock.calls.map(([op]) => op)).toEqual(["beginIncomingKeep"]);
    await f.objects.put(sourceKey, new TextEncoder().encode("bad"), "text/plain");
    await expect(f.service.keep(id, "source", { id: copyId })).rejects.toMatchObject({
      code: "file_unavailable",
    });
    expect(f.metadata.call).toHaveBeenLastCalledWith("abortIncomingKeep", {
      accountId: "recipient",
      incomingId: id,
      fileId: "source",
      id: copyId,
    });
  });
  it("passes quota refusal through without touching storage and cancellation reconciles a committed copy", async () => {
    const f = await fixture();
    const copy = vi.spyOn(f.objects, "copy");
    f.setFailure(new OwnedTransferError("quota_exceeded", 409));
    await expect(f.service.keep(id, "source", { id: copyId })).rejects.toMatchObject({
      code: "quota_exceeded",
    });
    expect(copy).not.toHaveBeenCalled();
    const committed = await fixture();
    await committed.service.keep(id, "source", { id: copyId });
    expect(await committed.service.abortKeep(id, "source", { id: copyId })).toMatchObject({
      state: "kept",
      file: { id: copyId },
    });
  });
});
