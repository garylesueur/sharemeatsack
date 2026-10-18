import { describe, expect, it, vi } from "vitest";
import type { LibraryMetadata } from "./library-metadata";
import { OwnedTransferError } from "./owned-transfer-metadata";
import { createMemoryObjectStore, createR2ObjectStore } from "./object-store";
import { createMemoryTransferStore, type Transfer } from "./transfer-store";
import { createMemoryCleanroom } from "./cleanroom";
import {
  createTransferService,
  isTransferServiceError,
  type TransferServiceError,
} from "./transfers";

function fixture() {
  let at = Date.parse("2026-10-10T12:00:00Z"),
    ids = 0,
    tokens = 0;
  const now = () => new Date(at);
  const store = createMemoryTransferStore(),
    objects = createMemoryObjectStore(now);
  const scanner = createMemoryCleanroom();
  const attempts = new Map<string, { attemptId: string; objectKey: string }>();
  const metadata: LibraryMetadata = {
    async call(operation, args) {
      const row = await store.getById(String(args.id));
      if (operation === "getById") return row ? JSON.stringify(row) : null;
      const file = row?.files?.find((candidate) => candidate.id === args.fileId);
      if (!row || !file) return null;
      if (operation === "beginSeal") {
        if (attempts.has(file.id) || file.state === "accepted") return null;
        const attemptId = String(args.attemptId),
          objectKey = `sharemeatsack/owned/${row.id}/${file.id}/sealed/${attemptId}`;
        attempts.set(file.id, { attemptId, objectKey });
        return {
          uploadKey: file.key,
          objectKey,
          size: file.size,
          attemptId,
          deadlineAt: at + 120_000,
        };
      }
      const attempt = attempts.get(file.id);
      if (!attempt || attempt.attemptId !== args.attemptId) return false;
      if (operation === "commitSeal") {
        if (args.observedBytes !== file.size || row.status !== "open") return false;
        await store.save({
          ...row,
          files: row.files?.map((candidate) =>
            candidate.id !== file.id
              ? candidate
              : {
                  ...candidate,
                  key: attempt.objectKey,
                  state: "accepted",
                  scanStatus: "scanning",
                  ...(row.kind === "request"
                    ? {
                        receivedAt: now().toISOString(),
                        retainedUntil: new Date(at + 90 * 86_400_000).toISOString(),
                      }
                    : {}),
                },
          ),
        });
        return true;
      }
      if (operation === "failSeal") return true;
      throw new Error("Unexpected operation");
    },
  };
  const transfers = createTransferService({
    store,
    objectStore: objects,
    scanner,
    ownedMetadata: metadata,
    now,
    createId: () => `transfer-${++ids}`,
    createFileId: () => `file-${++ids}`,
    createToken: () => `capability-${++tokens}`,
  });
  return {
    store,
    objects,
    scanner,
    metadata,
    transfers,
    now,
    advance: (ms: number) => {
      at += ms;
    },
  };
}
function created<T>(result: T): Exclude<T, TransferServiceError> {
  if (isTransferServiceError(result)) throw new Error(result.code);
  return result as Exclude<T, TransferServiceError>;
}

describe("Workspace B2 — owned files and retained authority", () => {
  it("does not issue upload capabilities when send creation or a request offer exceeds allowance", async () => {
    const { store, objects, transfers } = fixture();
    const sign = vi.spyOn(objects, "presignPut");
    const save = store.save;
    store.save = async () => {
      throw new OwnedTransferError("storage_allowance", 413);
    };
    expect(
      await transfers.createSend(
        { title: "Too full", files: [{ name: "one.txt", size: 1 }] },
        "owner",
      ),
    ).toMatchObject({ status: 413, code: "storage_allowance" });
    expect(sign).not.toHaveBeenCalled();
    store.save = save;
    const request = created(await transfers.createRequest({ title: "Receipt" }, "owner"));
    store.compareAndSave = async () => {
      throw new OwnedTransferError("storage_allowance", 413);
    };
    expect(
      await transfers.registerFiles({
        transferId: request.transferId,
        publicToken: "capability-3",
        body: { files: [{ name: "one.txt", size: 1 }] },
      }),
    ).toMatchObject({ status: 413, code: "storage_allowance" });
    expect(sign).not.toHaveBeenCalled();
  });

  it("seals and scans a frozen owned object while an old staging PUT remains unable to change readable bytes", async () => {
    const { store, objects, transfers, scanner } = fixture();
    const send = created(
      await transfers.createSend(
        { title: "Owned", files: [{ name: "notes.txt", type: "text/plain", size: 2 }] },
        "owner",
      ),
    );
    const file = (await store.getById(send.transferId))!.files![0];
    await objects.put(file.key!, new Uint8Array([1, 2]), file.contentType);
    expect(
      await transfers.complete({ transferId: send.transferId, agentToken: "capability-2" }),
    ).toMatchObject({ status: "ready" });
    const accepted = (await store.getById(send.transferId))!.files![0];
    expect(accepted.key).toMatch(/\/sealed\/[A-Za-z0-9_-]+$/);
    expect([...scanner.submitted.values()][0].url).toContain("/sealed/");
    await objects.put(file.key!, new Uint8Array([9, 9]), file.contentType);
    expect((await objects.get(accepted.key!))?.body).toEqual(new Uint8Array([1, 2]));
    expect(
      await transfers.refreshUploadUrl({
        transferId: send.transferId,
        fileId: file.id,
        agentToken: "capability-2",
      }),
    ).toMatchObject({ status: 409 });
    const detail = await transfers.getForAccount("owner", send.transferId);
    expect(detail).toMatchObject({
      publicAccessAvailable: true,
      files: [{ canRead: true, canKeep: false }],
    });
    expect(JSON.stringify(detail)).not.toMatch(
      /agentToken|manageUrl|pollUrl|sealed\/|uploadExpiresAt/,
    );
  });

  it("submits accepted sealed bytes before a scan verdict and blocks all download paths after an infected result", async () => {
    const { store, objects, transfers, scanner } = fixture();
    const send = created(
      await transfers.createSend(
        { title: "Scan authority", files: [{ name: "one.txt", size: 1 }] },
        "owner",
      ),
    );
    const offered = (await store.getById(send.transferId))!.files![0];
    await objects.put(offered.key!, new Uint8Array([1]), offered.contentType);
    const authorityStates: string[] = [];
    store.fileAccess = async (id) => {
      const current = (await store.getById(id))!;
      return (current.files ?? []).flatMap((file) => {
        authorityStates.push(file.scanStatus ?? "pending");
        return file.state === "accepted" && file.key?.includes("/sealed/") ? [file.id] : [];
      });
    };
    const submit = vi.spyOn(scanner, "submit").mockImplementation(async () => {
      expect((await store.getById(send.transferId))!.files![0]).toMatchObject({
        state: "accepted",
        scanStatus: "scanning",
      });
      return {
        handle: "blocked-scan",
        state: "finished",
        verdict: { verdict: "infected", signature: "Test-Signature" },
      };
    });
    expect(
      await transfers.complete({ transferId: send.transferId, agentToken: "capability-2" }),
    ).toMatchObject({ status: "cancelled" });
    expect(submit).toHaveBeenCalledOnce();
    expect(authorityStates).toContain("scanning");
    const sign = vi.spyOn(objects, "presignGet");
    expect(await transfers.getForAccount("owner", send.transferId)).toMatchObject({
      files: [{ scanStatus: "infected", canRead: false, canKeep: false }],
    });
    expect(
      await transfers.getForPublic({ transferId: send.transferId, publicToken: "capability-1" }),
    ).toMatchObject({ files: [] });
    expect(
      await transfers.readFileForAccount({
        account: "owner",
        transferId: send.transferId,
        fileId: offered.id,
      }),
    ).toMatchObject({ status: 404 });
    expect(
      await transfers.readFileUrl({
        transferId: send.transferId,
        fileId: offered.id,
        token: "capability-2",
      }),
    ).toMatchObject({ status: 404 });
    expect(
      await transfers.readFileUrl({
        transferId: send.transferId,
        fileId: offered.id,
        token: "capability-1",
      }),
    ).toMatchObject({ status: 404 });
    expect(sign).not.toHaveBeenCalled();
  });

  it("keeps completed request receipts readable to their owner after public expiry and refuses them at 90 days", async () => {
    const { store, objects, transfers, advance } = fixture();
    const request = created(
      await transfers.createRequest({ title: "Receipt", expiresInSeconds: 60 }, "owner"),
    );
    const offered = created(
      await transfers.registerFiles({
        transferId: request.transferId,
        publicToken: "capability-1",
        body: { files: [{ name: "receipt.txt", size: 1 }] },
      }),
    );
    const source = (await store.getById(request.transferId))!.files![0];
    await objects.put(source.key!, new Uint8Array([7]), source.contentType);
    expect(
      await transfers.complete({ transferId: request.transferId, publicToken: "capability-1" }),
    ).toMatchObject({ status: "complete" });
    advance(61_000);
    expect(
      await transfers.getForPublic({ transferId: request.transferId, publicToken: "capability-1" }),
    ).toMatchObject({ status: "expired", files: [] });
    expect(await transfers.getForAccount("owner", request.transferId)).toMatchObject({
      files: [{ canRead: true, canKeep: true }],
    });
    expect(
      await transfers.readFileForAccount({
        account: "other",
        transferId: request.transferId,
        fileId: offered.files[0].id,
      }),
    ).toMatchObject({ status: 404 });
    expect(
      await transfers.readFileForAccount({
        account: "owner",
        transferId: request.transferId,
        fileId: offered.files[0].id,
      }),
    ).toHaveProperty("url");
    advance(90 * 86_400_000 - 61_000);
    expect(await transfers.getForAccount("owner", request.transferId)).toMatchObject({
      files: [{ canRead: false, canKeep: false }],
    });
    expect(
      await transfers.readFileForAccount({
        account: "owner",
        transferId: request.transferId,
        fileId: offered.files[0].id,
      }),
    ).toMatchObject({ status: 404 });
    expect(
      await transfers.readFileUrl({
        transferId: request.transferId,
        fileId: offered.files[0].id,
        token: "capability-2",
      }),
    ).toMatchObject({ status: 404 });
  });

  it("refreshes an owned PUT only within its original deadline, without extending retention", async () => {
    const { store, objects, transfers, advance } = fixture();
    const send = created(
      await transfers.createSend(
        { title: "Retry", files: [{ name: "one.txt", size: 1 }] },
        "owner",
      ),
    );
    const file = (await store.getById(send.transferId))!.files![0];
    const deadline = file.uploadExpiresAt;
    advance(30 * 60_000);
    const result = await transfers.refreshUploadUrl({
      transferId: send.transferId,
      fileId: file.id,
      agentToken: "capability-2",
    });
    expect(result).toMatchObject({ expiresAt: deadline });
    const spy = vi.spyOn(objects, "presignPut");
    advance(30 * 60_000);
    expect(
      await transfers.refreshUploadUrl({
        transferId: send.transferId,
        fileId: file.id,
        agentToken: "capability-2",
      }),
    ).toMatchObject({ status: 409, code: "upload_not_open" });
    expect(spy).not.toHaveBeenCalled();
    expect((await store.getById(send.transferId))!.files![0].uploadExpiresAt).toBe(deadline);
  });

  it("rechecks owner/file authority after a provider HEAD wait before minting a file read", async () => {
    const { store, objects, transfers, now } = fixture();
    const transfer: Transfer = {
      id: "ready",
      ownerAccountId: "owner",
      kind: "send",
      title: "Ready",
      createdAt: now().toISOString(),
      expiresAt: new Date(now().getTime() + 60_000).toISOString(),
      status: "ready",
      publicToken: "public",
      agentToken: "private",
      files: [
        {
          id: "file",
          filename: "one.txt",
          contentType: "text/plain",
          size: 1,
          key: "sealed",
          state: "accepted",
          scanStatus: "clean",
        },
      ],
    };
    await store.save(transfer);
    await objects.put("sealed", new Uint8Array([1]), "text/plain");
    const head = objects.head;
    objects.head = async (key) => {
      await store.delete(transfer.id);
      return head(key);
    };
    const sign = vi.spyOn(objects, "presignGet");
    expect(
      await transfers.readFileForAccount({
        account: "owner",
        transferId: transfer.id,
        fileId: "file",
      }),
    ).toMatchObject({ status: 404 });
    expect(sign).not.toHaveBeenCalled();
  });

  it("refuses new read capabilities after current file authority is detached without rewriting the canonical transfer", async () => {
    const { store, objects, transfers } = fixture();
    const send = created(
      await transfers.createSend(
        { title: "Library send", files: [{ name: "one.txt", size: 1 }] },
        "owner",
      ),
    );
    const pending = (await store.getById(send.transferId))!.files![0];
    await objects.put(pending.key!, new Uint8Array([1]), pending.contentType);
    created(
      await transfers.getForAgent({ transferId: send.transferId, agentToken: "capability-2" }),
    );
    const ready = (await store.getById(send.transferId))!;
    const file = ready.files![0];
    let authorized = true;
    store.fileAccess = async () => (authorized ? [file.id] : []);
    expect(await transfers.getForAccount("owner", ready.id)).toMatchObject({
      files: [{ canRead: true }],
    });
    const head = objects.head;
    objects.head = async (key) => {
      authorized = false;
      return head(key);
    };
    const sign = vi.spyOn(objects, "presignGet");
    expect(
      await transfers.readFileForAccount({
        account: "owner",
        transferId: ready.id,
        fileId: file.id,
      }),
    ).toMatchObject({ status: 404 });
    authorized = true;
    expect(
      await transfers.readFileUrl({ transferId: ready.id, fileId: file.id, token: "capability-2" }),
    ).toMatchObject({ status: 404 });
    expect(await transfers.getForAccount("owner", ready.id)).toMatchObject({
      files: [{ canRead: false, canKeep: false }],
    });
    const agent = created(
      await transfers.getForAgent({ transferId: ready.id, agentToken: "capability-2" }),
    );
    expect(agent.files?.[0]).not.toHaveProperty("downloadUrl");
    expect(
      await transfers.getForPublic({ transferId: ready.id, publicToken: "capability-1" }),
    ).toMatchObject({ files: [] });
    expect(
      await transfers.readFileUrl({ transferId: ready.id, fileId: file.id, token: "capability-1" }),
    ).toMatchObject({ status: 404 });
    expect(sign).not.toHaveBeenCalled();
    expect(await store.getById(ready.id)).toEqual(ready);
  });

  it("rechecks public retirement after current storage authority is read", async () => {
    const { store, objects, transfers } = fixture();
    const send = created(
      await transfers.createSend(
        { title: "Retiring", files: [{ name: "one.txt", size: 1 }] },
        "owner",
      ),
    );
    const file = (await store.getById(send.transferId))!.files![0];
    await objects.put(file.key!, new Uint8Array([1]), file.contentType);
    created(
      await transfers.getForAgent({ transferId: send.transferId, agentToken: "capability-2" }),
    );
    store.fileAccess = async (id) => {
      const current = (await store.getById(id))!;
      await store.save({ ...current, status: "cancelled" });
      return [file.id];
    };
    const sign = vi.spyOn(objects, "presignGet");
    expect(
      await transfers.getForPublic({ transferId: send.transferId, publicToken: "capability-1" }),
    ).toMatchObject({ files: [] });
    expect(sign).not.toHaveBeenCalled();
  });

  it("preserves production send recovery when a transient HEAD outage occurs before sealing", async () => {
    const { store, objects, transfers } = fixture();
    const send = created(
      await transfers.createSend({ title: "Legacy", files: [{ name: "one.txt", size: 1 }] }),
    );
    const file = (await store.getById(send.transferId))!.files![0];
    await objects.put(file.key!, new Uint8Array([1]), file.contentType);
    const head = objects.head;
    objects.head = async () => {
      throw new Error("Temporary storage outage");
    };
    expect(
      await transfers.getForAgent({ transferId: send.transferId, agentToken: "capability-2" }),
    ).toMatchObject({ status: "open" });
    objects.head = head;
    expect(
      await transfers.getForAgent({ transferId: send.transferId, agentToken: "capability-2" }),
    ).toMatchObject({ status: "ready" });
  });
});

it("Workspace B2 — owned R2 PUT signatures bind quota-admitted size/type and never target a sealed object", async () => {
  const store = createR2ObjectStore({
    accountId: "test",
    accessKeyId: "test-key",
    secretAccessKey: "test-secret",
    bucket: "test",
    endpoint: "https://test.r2.cloudflarestorage.com",
  });
  const input = {
    key: "sharemeatsack/owned/transfer/file/upload",
    contentType: "text/plain",
    contentLength: 1,
  };
  const signed = new URL((await store.presignPut(input)).url);
  const changed = new URL((await store.presignPut({ ...input, contentLength: 2 })).url);
  expect(signed.searchParams.get("X-Amz-SignedHeaders")?.split(";")).toEqual([
    "content-length",
    "content-type",
    "host",
  ]);
  expect(changed.searchParams.get("X-Amz-Signature")).not.toBe(
    signed.searchParams.get("X-Amz-Signature"),
  );
  await expect(
    store.presignPut({ ...input, key: "sharemeatsack/owned/transfer/file/sealed/attempt" }),
  ).rejects.toThrow("staging");
});
