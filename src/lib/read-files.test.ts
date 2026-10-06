import { describe, expect, it } from "vitest";
import { createMemoryObjectStore } from "./object-store";
import { createMemoryTransferStore, type Transfer } from "./transfer-store";
import { createTransferService, isTransferServiceError } from "./transfers";

async function fixture(overrides: Partial<Transfer> = {}) {
  let now = new Date("2026-10-06T12:00:00.000Z");
  const store = createMemoryTransferStore();
  const objectStore = createMemoryObjectStore(() => now);
  const transfer: Transfer = {
    id: "send",
    kind: "send",
    title: "Files",
    status: "ready",
    createdAt: now.toISOString(),
    expiresAt: "2026-10-07T12:00:00.000Z",
    publicToken: "public",
    agentToken: "private",
    files: [
      {
        id: "file",
        filename: "original.txt",
        contentType: "text/plain",
        size: 8,
        key: "stored/original",
        state: "accepted",
        scanStatus: "clean",
      },
    ],
    ...overrides,
  };
  await store.save(transfer);
  await objectStore.put("stored/original", new TextEncoder().encode("original"), "text/plain");
  const service = createTransferService({
    store,
    objectStore,
    scanner: null,
    now: () => now,
    createId: () => "unused",
    createToken: () => "unused",
  });
  return {
    service,
    store,
    objectStore,
    transfer,
    advance: (date: string) => {
      now = new Date(date);
    },
  };
}

const input = { transferId: "send", fileId: "file", token: "public" };

describe("Viewing B8/B9 — authorised renewable file access", () => {
  it("mints purpose-bound, short-lived public-send access and refuses expired public access", async () => {
    const { service, objectStore, advance } = await fixture();
    const preview = await service.readFileUrl({ ...input, purpose: "preview" });
    const download = await service.readFileUrl(input);
    if (isTransferServiceError(preview) || isTransferServiceError(download))
      throw new Error("expected access");
    expect(preview.expiresAt).toBe("2026-10-06T12:15:00.000Z");
    expect(
      objectStore.authorizeRead?.("stored/original", new URL(preview.url, "http://localhost"))
        ?.contentDisposition,
    ).toMatch(/^inline;/);
    expect(
      objectStore.authorizeRead?.("stored/original", new URL(download.url, "http://localhost"))
        ?.contentDisposition,
    ).toMatch(/^attachment;/);
    advance("2026-10-08T12:00:00.000Z");
    expect(await service.readFileUrl(input)).toMatchObject({ code: "not_found", status: 404 });
  });

  it.each(["complete", "expired", "cancelled"] as const)(
    "preserves private request reads for retained accepted files in %s, without granting upload-token reads",
    async (status) => {
      const { service } = await fixture({
        kind: "request",
        status,
        expiresAt: "2026-10-05T12:00:00.000Z",
      });
      expect(await service.readFileUrl({ ...input, token: "private" })).toHaveProperty("url");
      expect(await service.readFileUrl(input)).toMatchObject({ code: "not_found", status: 404 });
    },
  );

  it("uses the same refusal for bad capabilities, foreign files, pending and blocked files", async () => {
    const { service, store, transfer } = await fixture();
    const unavailable = { code: "not_found", message: "File not found", status: 404 };
    await Promise.all(
      [
        { ...input, token: "wrong" },
        { ...input, token: undefined },
        { ...input, fileId: "foreign" },
        { ...input, transferId: "other" },
      ].map(async (request) => expect(await service.readFileUrl(request)).toEqual(unavailable)),
    );
    await Promise.all(
      ["infected", "failed", "scanning", undefined].map(async (scanStatus) => {
        const blocked = await fixture({ files: [{ ...transfer.files![0]!, scanStatus }] });
        expect(await blocked.service.readFileUrl({ ...input, token: "private" })).toEqual(
          unavailable,
        );
      }),
    );
    await store.save({
      ...transfer,
      files: [{ ...transfer.files![0]!, state: "pending" }],
    });
    expect(await service.readFileUrl({ ...input, token: "private" })).toEqual(unavailable);
  });

  it("offers skipped-too-large files but denies a cancelled public send and a deleted retained object", async () => {
    const { service, transfer, store, objectStore } = await fixture();
    await store.save({
      ...transfer,
      files: transfer.files?.map((file) => ({ ...file, scanStatus: "skipped-too-large" })),
    });
    expect(await service.readFileUrl(input)).toHaveProperty("url");
    await store.save({ ...transfer, status: "cancelled" });
    expect(await service.readFileUrl(input)).toMatchObject({ code: "not_found" });
    expect(await service.readFileUrl({ ...input, token: "private" })).toHaveProperty("url");
    await objectStore.delete("stored/original");
    expect(await service.readFileUrl({ ...input, token: "private" })).toMatchObject({
      code: "not_found",
    });
  });

  it("does not grant private reads before a transfer closes", async () => {
    const { service } = await fixture({ kind: "request", status: "open" });
    expect(await service.readFileUrl({ ...input, token: "private" })).toMatchObject({
      code: "not_found",
    });
  });
});
