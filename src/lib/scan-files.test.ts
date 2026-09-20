import { describe, expect, it } from "vitest";
import {
  createHttpCleanroom,
  createMemoryCleanroom,
  SCAN_LINK_TTL_SECONDS,
  verifyCleanroomSignature,
  type MemoryCleanroom,
} from "./cleanroom";
import { createMemoryObjectStore } from "./object-store";
import { SCAN_SIZE_CAP_BYTES } from "./schema";
import { createMemoryTransferStore } from "./transfer-store";
import {
  createTransferService,
  humanScreenFor,
  isTransferServiceError,
  uploadPageCopy,
} from "./transfers";

const tooLarge = SCAN_SIZE_CAP_BYTES + 1024 * 1024;

function scanService(scanner: MemoryCleanroom = createMemoryCleanroom({ hold: true })) {
  const store = createMemoryTransferStore();
  const objectStore = createMemoryObjectStore();
  let files = 0;
  const transfers = createTransferService({
    store,
    objectStore,
    scanner,
    now: () => new Date("2026-09-19T12:00:00.000Z"),
    createId: () => "transfer-1",
    createFileId: () => `file-${++files}`,
    createToken: (() => {
      let n = 0;
      return () => `token-${++n}`;
    })(),
  });
  return { store, objectStore, transfers, scanner };
}

async function putAll(
  store: ReturnType<typeof createMemoryTransferStore>,
  objectStore: ReturnType<typeof createMemoryObjectStore>,
) {
  const saved = await store.getById("transfer-1");
  for (const file of saved?.files ?? []) {
    if (!file.key) {
      throw new Error("expected key");
    }
    objectStore.objects.set(file.key, {
      body: new Uint8Array(0),
      contentType: file.contentType,
      size: file.size,
    });
  }
}

describe("B6 — a file is scanned before anyone may take it", () => {
  it("keeps a sealed request at scanning and withholds download URLs", async () => {
    const { transfers, store, objectStore } = scanService();
    await transfers.createRequest({ title: "Invoices" });
    await transfers.registerFiles({
      transferId: "transfer-1",
      publicToken: "token-1",
      body: { files: [{ name: "one.pdf", type: "application/pdf", size: 4 }] },
    });
    await putAll(store, objectStore);
    const sealed = await transfers.complete({
      transferId: "transfer-1",
      publicToken: "token-1",
    });
    expect(sealed).toMatchObject({ status: "scanning" });
    const agent = await transfers.getForAgent({
      transferId: "transfer-1",
      agentToken: "token-2",
    });
    expect(agent).toMatchObject({
      status: "scanning",
      files: [{ name: "one.pdf", scanStatus: "scanning" }],
    });
    if (isTransferServiceError(agent)) {
      throw new Error("expected agent view");
    }
    expect(agent.files[0]?.downloadUrl).toBeUndefined();
    const person = await transfers.getForPublic({
      transferId: "transfer-1",
      publicToken: "token-1",
    });
    expect(humanScreenFor(person)).toBe("scanning");
    expect(uploadPageCopy("scanning").heading).toBe("We're checking these files");
  });
});

describe("B7 / B8 / B9 / B10 — verdicts", () => {
  it("offers a clean file once the verdict arrives", async () => {
    const { transfers, store, objectStore, scanner } = scanService();
    await transfers.createRequest({ title: "Invoices" });
    await transfers.registerFiles({
      transferId: "transfer-1",
      publicToken: "token-1",
      body: { files: [{ name: "one.pdf", type: "application/pdf", size: 4 }] },
    });
    await putAll(store, objectStore);
    await transfers.complete({ transferId: "transfer-1", publicToken: "token-1" });
    const handle = (await store.getById("transfer-1"))?.files?.[0]?.scanHandle;
    if (!handle) {
      throw new Error("expected handle");
    }
    scanner.resolve(handle, { verdict: "clean" });
    const agent = await transfers.getForAgent({
      transferId: "transfer-1",
      agentToken: "token-2",
    });
    expect(agent).toMatchObject({
      status: "complete",
      files: [{ name: "one.pdf", scanStatus: "clean" }],
    });
    if (isTransferServiceError(agent)) {
      throw new Error("expected agent view");
    }
    expect(agent.files[0]?.downloadUrl).toMatch(/^\/api\/v1\/objects\//);
  });

  it("blocks an infected file, names the signature, and destroys the object", async () => {
    const { transfers, store, objectStore, scanner } = scanService();
    await transfers.createRequest({ title: "Invoices" });
    await transfers.registerFiles({
      transferId: "transfer-1",
      publicToken: "token-1",
      body: { files: [{ name: "bad.pdf", type: "application/pdf", size: 4 }] },
    });
    await putAll(store, objectStore);
    await transfers.complete({ transferId: "transfer-1", publicToken: "token-1" });
    const saved = await store.getById("transfer-1");
    const file = saved?.files?.[0];
    if (!file?.scanHandle || !file.key) {
      throw new Error("expected file");
    }
    expect(objectStore.objects.has(file.key)).toBe(true);
    scanner.resolve(file.scanHandle, { verdict: "infected", signature: "Eicar-Test-Signature" });
    const agent = await transfers.getForAgent({
      transferId: "transfer-1",
      agentToken: "token-2",
    });
    expect(agent).toMatchObject({
      status: "complete",
      files: [{ name: "bad.pdf", scanStatus: "infected", scanSignature: "Eicar-Test-Signature" }],
    });
    if (isTransferServiceError(agent)) {
      throw new Error("expected agent view");
    }
    expect(agent.files[0]?.downloadUrl).toBeUndefined();
    expect(objectStore.objects.has(file.key)).toBe(false);
  });

  it("offers a 600 MiB file as skipped-too-large with a GET", async () => {
    const { transfers, store, objectStore } = scanService(
      createMemoryCleanroom({
        hold: false,
      }),
    );
    await transfers.createRequest({ title: "Invoices" });
    await transfers.registerFiles({
      transferId: "transfer-1",
      publicToken: "token-1",
      body: { files: [{ name: "huge.bin", type: "application/octet-stream", size: tooLarge }] },
    });
    await putAll(store, objectStore);
    const sealed = await transfers.complete({
      transferId: "transfer-1",
      publicToken: "token-1",
    });
    expect(sealed).toMatchObject({ status: "complete" });
    const agent = await transfers.getForAgent({
      transferId: "transfer-1",
      agentToken: "token-2",
    });
    expect(agent).toMatchObject({
      files: [{ name: "huge.bin", scanStatus: "skipped-too-large" }],
    });
    if (isTransferServiceError(agent)) {
      throw new Error("expected agent view");
    }
    expect(agent.files[0]?.downloadUrl).toMatch(/^\/api\/v1\/objects\//);
  });

  it("keeps a failed scan blocked", async () => {
    const { transfers, store, objectStore, scanner } = scanService();
    await transfers.createRequest({ title: "Invoices" });
    await transfers.registerFiles({
      transferId: "transfer-1",
      publicToken: "token-1",
      body: { files: [{ name: "one.pdf", type: "application/pdf", size: 4 }] },
    });
    await putAll(store, objectStore);
    await transfers.complete({ transferId: "transfer-1", publicToken: "token-1" });
    const handle = (await store.getById("transfer-1"))?.files?.[0]?.scanHandle;
    if (!handle) {
      throw new Error("expected handle");
    }
    scanner.resolve(handle, { verdict: "failed", reason: "scanner down" });
    const agent = await transfers.getForAgent({
      transferId: "transfer-1",
      agentToken: "token-2",
    });
    expect(agent).toMatchObject({
      status: "complete",
      files: [{ name: "one.pdf", scanStatus: "failed" }],
    });
    if (isTransferServiceError(agent)) {
      throw new Error("expected agent view");
    }
    expect(agent.files[0]?.downloadUrl).toBeUndefined();
  });
});

describe("sending — scan gate", () => {
  it("does not serve a send until every verdict is in", async () => {
    const { transfers, store, objectStore } = scanService();
    await transfers.create({
      action: "send",
      title: "For Simon",
      files: [{ name: "one.pdf", type: "application/pdf", size: 4 }],
    });
    await putAll(store, objectStore);
    const sealed = await transfers.complete({
      transferId: "transfer-1",
      agentToken: "token-2",
    });
    expect(sealed).toMatchObject({ status: "scanning" });
    const person = await transfers.getForPublic({
      transferId: "transfer-1",
      publicToken: "token-1",
    });
    expect(humanScreenFor(person)).toBe("not_ready");
    if (isTransferServiceError(person)) {
      throw new Error("expected public view");
    }
    expect(person.files).toEqual([]);
  });

  it("cancels a send that has nothing left to take after infection", async () => {
    const { transfers, store, objectStore, scanner } = scanService();
    await transfers.create({
      action: "send",
      title: "For Simon",
      files: [{ name: "bad.pdf", type: "application/pdf", size: 4 }],
    });
    await putAll(store, objectStore);
    await transfers.complete({ transferId: "transfer-1", agentToken: "token-2" });
    const handle = (await store.getById("transfer-1"))?.files?.[0]?.scanHandle;
    if (!handle) {
      throw new Error("expected handle");
    }
    scanner.resolve(handle, { verdict: "infected", signature: "Eicar-Test-Signature" });
    const agent = await transfers.getForAgent({
      transferId: "transfer-1",
      agentToken: "token-2",
    });
    expect(agent).toMatchObject({ status: "cancelled" });
    const person = await transfers.getForPublic({
      transferId: "transfer-1",
      publicToken: "token-1",
    });
    expect(humanScreenFor(person)).toBe("cancelled");
    if (isTransferServiceError(person)) {
      throw new Error("expected public view");
    }
    expect(person.files).toEqual([]);
  });

  it("omits an infected file from a ready send and flags a skipped file", async () => {
    const scanner = createMemoryCleanroom({ hold: true });
    const { transfers, store, objectStore } = scanService(scanner);
    await transfers.create({
      action: "send",
      title: "For Simon",
      files: [
        { name: "ok.pdf", type: "application/pdf", size: 4 },
        { name: "bad.pdf", type: "application/pdf", size: 4 },
        { name: "huge.bin", type: "application/octet-stream", size: tooLarge },
      ],
    });
    await putAll(store, objectStore);
    await transfers.complete({ transferId: "transfer-1", agentToken: "token-2" });
    const saved = await store.getById("transfer-1");
    const byName = new Map((saved?.files ?? []).map((file) => [file.filename, file]));
    const ok = byName.get("ok.pdf")?.scanHandle;
    const bad = byName.get("bad.pdf")?.scanHandle;
    const big = byName.get("huge.bin")?.scanHandle;
    if (!ok || !bad || !big) {
      throw new Error("expected handles");
    }
    scanner.resolve(ok, { verdict: "clean" });
    scanner.resolve(bad, { verdict: "infected", signature: "Eicar-Test-Signature" });
    scanner.resolve(big, {
      verdict: "too-large",
      declaredSizeBytes: tooLarge,
      capBytes: SCAN_SIZE_CAP_BYTES,
    });
    const person = await transfers.getForPublic({
      transferId: "transfer-1",
      publicToken: "token-1",
    });
    expect(humanScreenFor(person)).toBe("ready");
    if (isTransferServiceError(person)) {
      throw new Error("expected public view");
    }
    expect(person.files.map((file) => file.name)).toEqual(["ok.pdf", "huge.bin"]);
    expect(person.files.find((file) => file.name === "huge.bin")?.scanStatus).toBe(
      "skipped-too-large",
    );
    expect(person.files.find((file) => file.name === "bad.pdf")).toBeUndefined();
  });
});

describe("callback authenticity", () => {
  it("ignores a callback whose signature does not verify", async () => {
    const transfers = createTransferService({
      store: createMemoryTransferStore(),
      now: () => new Date("2026-09-19T12:00:00.000Z"),
      createId: () => "transfer-1",
      createToken: () => "token-1",
      scanner: createHttpCleanroom(
        {
          baseUrl: "https://cleanroom.example",
          credential: "c".repeat(32),
          webhookSecret: "s".repeat(32),
        },
        async () => new Response(JSON.stringify({ error: { code: "no" } }), { status: 500 }),
      ),
    });
    const ignored = await transfers.applyScanCallback({
      payload: JSON.stringify({ handle: "scn_x", verdict: { verdict: "clean" } }),
      signature: "t=1,v1=deadbeef",
    });
    expect(ignored).toMatchObject({ code: "not_found", status: 404 });
  });

  it("accepts a signed callback and applies the verdict", async () => {
    const { transfers, store, objectStore, scanner } = scanService();
    await transfers.createRequest({ title: "Invoices" });
    await transfers.registerFiles({
      transferId: "transfer-1",
      publicToken: "token-1",
      body: { files: [{ name: "one.pdf", type: "application/pdf", size: 4 }] },
    });
    await putAll(store, objectStore);
    await transfers.complete({ transferId: "transfer-1", publicToken: "token-1" });
    const handle = (await store.getById("transfer-1"))?.files?.[0]?.scanHandle;
    if (!handle) {
      throw new Error("expected handle");
    }
    const payload = JSON.stringify({
      handle,
      verdict: { verdict: "clean" },
      submittedAt: "2026-09-19T12:00:00.000Z",
      attempt: 1,
    });
    const applied = await transfers.applyScanCallback({ payload, signature: "memory" });
    expect(applied).toEqual({ ok: true });
    scanner.resolve(handle, { verdict: "clean" });
    const agent = await transfers.getForAgent({
      transferId: "transfer-1",
      agentToken: "token-2",
    });
    expect(agent).toMatchObject({ status: "complete", files: [{ scanStatus: "clean" }] });
  });

  it("presigns scan links for longer than an hour", () => {
    expect(SCAN_LINK_TTL_SECONDS).toBeGreaterThan(60 * 60);
  });

  it("rejects a forged cleanroom signature", () => {
    expect(
      verifyCleanroomSignature({
        payload: "{}",
        header: "t=100,v1=nope",
        secret: "s".repeat(32),
        now: new Date(100_000),
      }),
    ).toBe(false);
  });
});
