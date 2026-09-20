import { describe, expect, it } from "vitest";
import { FILE_MAX_BYTES } from "./schema";
import { createMemoryObjectStore } from "./object-store";
import { createMemoryTransferStore } from "./transfer-store";
import { createTransferService, isTransferServiceError } from "./transfers";

function uploadService() {
  const store = createMemoryTransferStore();
  const objectStore = createMemoryObjectStore();
  let files = 0;
  const transfers = createTransferService({
    store,
    objectStore,
    now: () => new Date("2026-09-19T12:00:00.000Z"),
    createId: () => "transfer-1",
    createFileId: () => `file-${++files}`,
    createToken: (() => {
      let n = 0;
      return () => `token-${++n}`;
    })(),
  });
  return { store, objectStore, transfers };
}

async function openRequest(
  transfers: ReturnType<typeof uploadService>["transfers"],
  extra?: { maxFiles?: number; maxFileSize?: number; allowedTypes?: string[] },
) {
  const created = await transfers.createRequest({
    title: "Invoices",
    ...extra,
  });
  if (isTransferServiceError(created)) {
    throw new Error("expected create");
  }
  return created;
}

describe("B2 / B3 — offered files are checked before a URL is minted", () => {
  it("registers two files under the cap, accepts the puts, and seals", async () => {
    const { transfers, objectStore, store } = uploadService();
    await openRequest(transfers);
    const registered = await transfers.registerFiles({
      transferId: "transfer-1",
      publicToken: "token-1",
      body: {
        files: [
          { name: "one.pdf", type: "application/pdf", size: 4 },
          { name: "two.pdf", type: "application/pdf", size: 5 },
        ],
      },
    });
    expect(isTransferServiceError(registered)).toBe(false);
    if (isTransferServiceError(registered)) {
      return;
    }
    expect(registered.files).toHaveLength(2);
    expect(registered.files[0]?.uploadUrl).toMatch(/^\/api\/v1\/objects\//);
    const saved = await store.getById("transfer-1");
    for (const file of saved?.files ?? []) {
      if (!file.key) {
        throw new Error("expected key");
      }
      await objectStore.put(file.key, new Uint8Array(file.size), file.contentType);
    }
    const sealed = await transfers.complete({
      transferId: "transfer-1",
      publicToken: "token-1",
    });
    expect(sealed).toMatchObject({
      transferId: "transfer-1",
      status: "complete",
      files: [
        { id: "file-1", name: "one.pdf", size: 4, type: "application/pdf" },
        { id: "file-2", name: "two.pdf", size: 5, type: "application/pdf" },
      ],
    });
    const again = await transfers.complete({
      transferId: "transfer-1",
      publicToken: "token-1",
    });
    expect(again).toEqual(sealed);
  });

  it("refuses a 6 GiB offer and never mints a URL", async () => {
    const { transfers, store } = uploadService();
    await openRequest(transfers);
    const refused = await transfers.registerFiles({
      transferId: "transfer-1",
      publicToken: "token-1",
      body: {
        files: [{ name: "huge.bin", type: "application/octet-stream", size: FILE_MAX_BYTES + 1 }],
      },
    });
    expect(refused).toMatchObject({ code: "too_large", status: 400 });
    expect(refused).not.toHaveProperty("files");
    expect((await store.getById("transfer-1"))?.files).toBeUndefined();
  });

  it("hides a bad public token the same way as an unknown id", async () => {
    const { transfers } = uploadService();
    await openRequest(transfers);
    const unknown = await transfers.registerFiles({
      transferId: "missing",
      publicToken: "token-1",
      body: { files: [{ name: "one.pdf", size: 4 }] },
    });
    const wrong = await transfers.registerFiles({
      transferId: "transfer-1",
      publicToken: "other",
      body: { files: [{ name: "one.pdf", size: 4 }] },
    });
    expect(unknown).toMatchObject({ code: "not_found", status: 404 });
    expect(wrong).toEqual(unknown);
  });

  it("issues a new PUT URL for the same pending file", async () => {
    const { transfers } = uploadService();
    await openRequest(transfers);
    const registered = await transfers.registerFiles({
      transferId: "transfer-1",
      publicToken: "token-1",
      body: { files: [{ name: "one.pdf", type: "application/pdf", size: 4 }] },
    });
    if (isTransferServiceError(registered)) {
      throw new Error("expected register");
    }
    const refreshed = await transfers.refreshUploadUrl({
      transferId: "transfer-1",
      fileId: "file-1",
      publicToken: "token-1",
    });
    if (isTransferServiceError(refreshed)) {
      throw new Error("expected refresh");
    }
    expect(refreshed.uploadUrl).not.toBe(registered.files[0]?.uploadUrl);
    expect(refreshed.uploadUrl).toMatch(/^\/api\/v1\/objects\//);
  });

  it("does not seal when the objects have not arrived", async () => {
    const { transfers, store } = uploadService();
    await openRequest(transfers);
    await transfers.registerFiles({
      transferId: "transfer-1",
      publicToken: "token-1",
      body: { files: [{ name: "one.pdf", type: "application/pdf", size: 4 }] },
    });
    const refused = await transfers.complete({
      transferId: "transfer-1",
      publicToken: "token-1",
    });
    expect(refused).toMatchObject({ code: "incomplete_upload", status: 409 });
    expect((await store.getById("transfer-1"))?.status).toBe("open");
  });

  it("lets the person remove a file before the request is sealed", async () => {
    const { transfers, objectStore, store } = uploadService();
    await openRequest(transfers);
    await transfers.registerFiles({
      transferId: "transfer-1",
      publicToken: "token-1",
      body: { files: [{ name: "one.pdf", type: "application/pdf", size: 4 }] },
    });
    const removed = await transfers.removeFile({
      transferId: "transfer-1",
      fileId: "file-1",
      publicToken: "token-1",
    });
    expect(removed).toEqual({ ok: true });
    expect((await store.getById("transfer-1"))?.files).toEqual([]);
    expect(objectStore.objects.size).toBe(0);
  });

  it("gives the agent names and download URLs after seal, not bytes", async () => {
    const { transfers, objectStore, store } = uploadService();
    await openRequest(transfers);
    await transfers.registerFiles({
      transferId: "transfer-1",
      publicToken: "token-1",
      body: {
        files: [
          { name: "one.pdf", type: "application/pdf", size: 4 },
          { name: "two.pdf", type: "application/pdf", size: 5 },
        ],
      },
    });
    const saved = await store.getById("transfer-1");
    for (const file of saved?.files ?? []) {
      if (!file.key) {
        throw new Error("expected key");
      }
      await objectStore.put(file.key, new Uint8Array(file.size), file.contentType);
    }
    await transfers.complete({ transferId: "transfer-1", publicToken: "token-1" });
    const status = await transfers.getForAgent({
      transferId: "transfer-1",
      agentToken: "token-2",
    });
    const listed = await transfers.listFiles({
      transferId: "transfer-1",
      agentToken: "token-2",
    });
    const waited = await transfers.wait({
      transferId: "transfer-1",
      agentToken: "token-2",
      seconds: 2,
    });
    expect(status).toMatchObject({
      files: [
        { name: "one.pdf", size: 4, scanStatus: "clean" },
        { name: "two.pdf", size: 5, scanStatus: "clean" },
      ],
    });
    if (
      isTransferServiceError(status) ||
      isTransferServiceError(listed) ||
      isTransferServiceError(waited)
    ) {
      throw new Error("expected agent views");
    }
    expect(listed.files.map((file) => file.name)).toEqual(["one.pdf", "two.pdf"]);
    expect(waited.files.map((file) => file.name)).toEqual(["one.pdf", "two.pdf"]);
    expect(listed.files[0]?.downloadUrl).toMatch(/^\/api\/v1\/objects\//);
    expect(status.files[0]?.downloadUrl).toMatch(/^\/api\/v1\/objects\//);
    expect(JSON.stringify(status)).not.toContain("AAAA");
    const open = await transfers.getForAgent({
      transferId: "transfer-1",
      agentToken: "token-1",
    });
    expect(open).toMatchObject({ code: "not_found", status: 404 });
    const markdown = await transfers.markdownForManage({
      transferId: "transfer-1",
      agentToken: "token-2",
    });
    expect(typeof markdown).toBe("string");
    if (typeof markdown !== "string") {
      return;
    }
    expect(markdown).toContain("# Invoices");
    expect(markdown).toContain("one.pdf");
    expect(markdown).toContain("two.pdf");
  });

  it("does not include download URLs while the request is still open", async () => {
    const { transfers } = uploadService();
    await openRequest(transfers);
    const status = await transfers.getForAgent({
      transferId: "transfer-1",
      agentToken: "token-2",
    });
    expect(status).toMatchObject({ status: "open", files: [] });
  });

  it("refuses register when storage is not configured", async () => {
    const store = createMemoryTransferStore();
    const transfers = createTransferService({
      store,
      now: () => new Date("2026-09-19T12:00:00.000Z"),
      createId: () => "transfer-1",
      createToken: (() => {
        let n = 0;
        return () => `token-${++n}`;
      })(),
    });
    await transfers.createRequest({ title: "Invoices" });
    const refused = await transfers.registerFiles({
      transferId: "transfer-1",
      publicToken: "token-1",
      body: { files: [{ name: "one.pdf", size: 4 }] },
    });
    expect(refused).toMatchObject({ code: "store_unavailable", status: 503 });
  });
});
