import { describe, expect, it } from "vitest";
import { createMemoryObjectStore } from "./object-store";
import { createMemoryTransferStore, type Transfer } from "./transfer-store";
import { createTransferService } from "./transfers";
import { createSharemeatsackTool } from "./sharemeatsack-tool";

const now = new Date("2026-10-07T12:00:00Z");

function sealed(id: string, count = 1, overrides: Partial<Transfer> = {}): Transfer {
  return {
    id,
    kind: "send",
    status: "ready",
    title: id,
    createdAt: now.toISOString(),
    completedAt: now.toISOString(),
    expiresAt: "2026-10-14T12:00:00Z",
    publicToken: `${id}-public`,
    agentToken: `${id}-private`,
    files: Array.from({ length: count }, (_, index) => ({
      id: `${id}-${index}`,
      filename: "invoice.pdf",
      contentType: "application/pdf",
      size: 3,
      key: `${id}/${index}`,
      state: "accepted",
      scanStatus: "clean",
      scanHandle: `${id}-scan-${index}`,
    })),
    ...overrides,
  };
}

async function fixture(primary = sealed("primary"), secondary = sealed("secondary")) {
  const store = createMemoryTransferStore();
  const objectStore = createMemoryObjectStore();
  for (const transfer of [primary, secondary]) {
    await store.save(transfer);
    for (const file of transfer.files ?? []) {
      if (file.key) await objectStore.put(file.key, new Uint8Array([1, 2, 3]), file.contentType);
      if (file.scanHandle) {
        await store.indexScan(file.scanHandle, { transferId: transfer.id, fileId: file.id });
      }
    }
  }
  const transfers = createTransferService({
    store,
    objectStore,
    now: () => now,
    createId: () => "unused",
    createToken: () => "unused",
  });
  const input = {
    transferId: primary.id,
    agentToken: primary.agentToken,
    body: { secondaryTransferId: secondary.id, secondaryAgentToken: secondary.agentToken },
  };
  return { store, objectStore, transfers, primary, secondary, input };
}

describe("Moving files B14 — merge transfers with both private capabilities", () => {
  it("prevents a stale upload registration from changing a sealed request", async () => {
    const { transfers, store } = await fixture(
      sealed("primary", 1, { kind: "request", status: "open" }),
    );
    const getById = store.getById;
    let sealedDuringRegistration = false;
    store.getById = async (id) => {
      const transfer = await getById(id);
      if (transfer && id === "primary" && !sealedDuringRegistration) {
        sealedDuringRegistration = true;
        await store.save({ ...transfer, status: "complete" });
      }
      return transfer;
    };
    expect(
      await transfers.registerFiles({
        transferId: "primary",
        publicToken: "primary-public",
        body: { files: [{ name: "late.pdf", type: "application/pdf", size: 3 }] },
      }),
    ).toMatchObject({ code: "closed", status: 409 });
    expect((await getById("primary"))?.files).toHaveLength(1);
  });

  it.each(["callback", "cancel"])(
    "does not restore moved files when an older %s finishes after the merge",
    async (action) => {
      const secondary = sealed("secondary", 1, action === "callback" ? { status: "scanning" } : {});
      const { transfers, input, store } = await fixture(undefined, secondary);
      const compareAndSave = store.compareAndSave;
      let release: () => void = () => {};
      let entered: () => void = () => {};
      const paused = new Promise<void>((resolve) => {
        release = resolve;
      });
      const waiting = new Promise<void>((resolve) => {
        entered = resolve;
      });
      let delayed = false;
      store.compareAndSave = async (updates) => {
        if (!delayed && updates.length === 1 && updates[0].before.id === "secondary") {
          delayed = true;
          entered();
          await paused;
        }
        return compareAndSave(updates);
      };
      const older =
        action === "callback"
          ? transfers.applyScanCallback({
              payload: JSON.stringify({
                handle: "secondary-scan-0",
                verdict: { verdict: "clean" },
              }),
              signature: "memory",
            })
          : transfers.cancel({ transferId: "secondary", agentToken: "secondary-private" });
      await waiting;
      if (action === "callback") {
        // Another scanner worker completes the share while the old callback waits.
        expect(
          await compareAndSave([{ before: secondary, after: { ...secondary, status: "ready" } }]),
        ).toBe(true);
      }
      expect(await transfers.merge(input)).toMatchObject({ movedFileCount: 1, totalFileCount: 2 });
      release();
      expect(await older).toMatchObject(
        action === "callback" ? { ok: true } : { code: "frozen", status: 409 },
      );
      expect((await store.getById("primary"))?.files).toHaveLength(2);
      expect(await store.getById("secondary")).toMatchObject({ status: "ready", files: [] });
    },
  );
  it("moves twenty plus ten files, preserves duplicate names and ownership metadata, and can retry", async () => {
    const { primary, secondary, store, objectStore, transfers, input } = await fixture(
      sealed("primary", 20),
      sealed("secondary", 10, { expiresAt: "2026-10-10T12:00:00Z" }),
    );
    const beforeObjects = new Map(objectStore.objects);
    const result = await transfers.merge(input);
    expect(result).toMatchObject({
      primaryTransferId: "primary",
      secondaryTransferId: "secondary",
      movedFileCount: 10,
      totalFileCount: 30,
      secondaryFileCount: 0,
      downloadUrl: expect.stringContaining("/s/primary?t=primary-public"),
      expiresAt: primary.expiresAt,
    });
    expect(await store.getById("primary")).toEqual({
      ...primary,
      files: [...(primary.files ?? []), ...(secondary.files ?? [])],
    });
    expect(await store.getById("secondary")).toEqual({ ...secondary, files: [] });
    expect(objectStore.objects).toEqual(beforeObjects);
    expect(await store.lookupScan("secondary-scan-0")).toEqual({
      transferId: "primary",
      fileId: "secondary-0",
    });
    expect(await transfers.merge(input)).toMatchObject({ movedFileCount: 0, totalFileCount: 30 });
    expect(
      await transfers.readFileUrl({
        transferId: "primary",
        fileId: "secondary-0",
        token: "primary-public",
      }),
    ).toMatchObject({ url: expect.any(String) });
    expect(
      await transfers.readFileUrl({
        transferId: "secondary",
        fileId: "secondary-0",
        token: "secondary-private",
      }),
    ).toMatchObject({ code: "not_found" });
    expect(
      await transfers.listFiles({ transferId: "secondary", agentToken: "secondary-private" }),
    ).toEqual({ files: [] });
    // A late duplicate scan callback must not restore files on the emptied share.
    expect(
      await transfers.applyScanCallback({
        payload: JSON.stringify({ handle: "secondary-scan-0", verdict: { verdict: "clean" } }),
        signature: "memory",
      }),
    ).toEqual({ ok: true });
    expect((await store.getById("primary"))?.files).toHaveLength(30);
    expect((await store.getById("secondary"))?.files).toEqual([]);
  });

  it.each([
    { agentToken: undefined },
    { agentToken: "primary-public" },
    { agentToken: "wrong" },
    { body: { secondaryTransferId: "secondary", secondaryAgentToken: "secondary-public" } },
    { body: { secondaryTransferId: "missing", secondaryAgentToken: "secondary-private" } },
  ])("conceals transfers when either capability is invalid: %j", async (override) => {
    const { transfers, input, store, primary, secondary } = await fixture();
    expect(await transfers.merge({ ...input, ...override })).toMatchObject({
      code: "not_found",
      status: 404,
    });
    expect(await store.getById("primary")).toEqual(primary);
    expect(await store.getById("secondary")).toEqual(secondary);
  });

  it("requires the secondary token and rejects merging a transfer with itself", async () => {
    const { transfers, input } = await fixture();
    expect(
      await transfers.merge({ ...input, body: { secondaryTransferId: "secondary" } }),
    ).toMatchObject({ code: "invalid_request", status: 400 });
    expect(
      await transfers.merge({
        ...input,
        body: { secondaryTransferId: "primary", secondaryAgentToken: "primary-private" },
      }),
    ).toMatchObject({ code: "same_transfer", status: 400 });
  });

  it.each([
    { status: "open" },
    { status: "scanning" },
    { status: "cancelled" },
    { expiresAt: now.toISOString(), kind: "request", status: "complete" },
    { files: sealed("secondary").files?.map((file) => ({ ...file, state: "pending" })) },
    { files: sealed("secondary").files?.map((file) => ({ ...file, scanStatus: "scanning" })) },
  ] satisfies Partial<Transfer>[])(
    "refuses an unfinished or expired participant: %j",
    async (override) => {
      for (const side of ["primary", "secondary"] as const) {
        const primary = sealed("primary", 1, side === "primary" ? override : {});
        const secondary = sealed("secondary", 1, side === "secondary" ? override : {});
        const { transfers, input, store } = await fixture(primary, secondary);
        expect(await transfers.merge(input)).toMatchObject({ code: "not_mergeable", status: 409 });
        expect(await store.getById("primary")).toEqual(primary);
        expect(await store.getById("secondary")).toEqual(secondary);
      }
    },
  );

  it.each([
    { primary: sealed("primary", 100), code: "too_many" },
    { primary: sealed("primary", 1, { maxFiles: 1 }), code: "too_many" },
    { primary: sealed("primary", 1, { maxFileSize: 2 }), code: "too_large" },
    { primary: sealed("primary", 1, { allowedTypes: ["image/png"] }), code: "kind_not_allowed" },
    {
      primary: sealed("primary", 4, {
        files: sealed("primary", 4).files?.map((file) => ({ ...file, size: 5 * 1024 ** 3 })),
      }),
      code: "transfer_too_large",
    },
    {
      secondary: sealed("secondary", 1, {
        files: sealed("secondary").files?.map((file) => ({ ...file, size: 5 * 1024 ** 3 + 1 })),
      }),
      code: "too_large",
    },
  ])("enforces primary and product limits without moving any files: $code", async (scenario) => {
    const { transfers, input, store, primary, secondary } = await fixture(
      scenario.primary,
      "secondary" in scenario ? scenario.secondary : undefined,
    );
    expect(await transfers.merge(input)).toMatchObject({ code: scenario.code, status: 400 });
    expect(await store.getById("primary")).toEqual(primary);
    expect(await store.getById("secondary")).toEqual(secondary);
  });

  it("keeps blocked scan verdicts blocked and does not widen a request's public access", async () => {
    const secondary = sealed("secondary", 3);
    secondary.files?.forEach((file, index) => {
      file.scanStatus = ["infected", "failed", "skipped-too-large"][index];
    });
    const { transfers, input, store } = await fixture(
      sealed("primary", 1, { kind: "request", status: "complete" }),
      secondary,
    );
    expect(await transfers.merge(input)).toMatchObject({ movedFileCount: 3 });
    expect(
      await transfers.listFiles({ transferId: "primary", agentToken: "primary-private" }),
    ).toMatchObject({
      files: [
        { scanStatus: "clean", downloadUrl: expect.any(String) },
        { scanStatus: "infected" },
        { scanStatus: "failed" },
        { scanStatus: "skipped-too-large", downloadUrl: expect.any(String) },
      ],
    });
    for (const fileId of ["secondary-0", "secondary-1"]) {
      expect(
        await transfers.readFileUrl({ transferId: "primary", fileId, token: "primary-private" }),
      ).toMatchObject({ code: "not_found" });
    }
    expect(
      await transfers.readFileUrl({
        transferId: "primary",
        fileId: "secondary-2",
        token: "primary-public",
      }),
    ).toMatchObject({ code: "not_found" });
    expect((await store.getById("primary"))?.status).toBe("complete");
  });

  it("refuses overlapping ids rather than silently replacing a file", async () => {
    const secondary = sealed("secondary");
    if (secondary.files?.[0]) secondary.files[0].id = "primary-0";
    const { transfers, input } = await fixture(undefined, secondary);
    expect(await transfers.merge(input)).toMatchObject({ code: "file_conflict", status: 409 });
  });

  it("does not duplicate a secondary when two primaries race to claim it", async () => {
    const { transfers, input, store } = await fixture();
    await store.save(sealed("other"));
    const results = await Promise.all([
      transfers.merge(input),
      transfers.merge({ ...input, transferId: "other", agentToken: "other-private" }),
    ]);
    expect(results.filter((result) => "movedFileCount" in result)).toHaveLength(1);
    expect(results).toContainEqual(
      expect.objectContaining({ code: "merge_conflict", status: 409 }),
    );
    const all = await Promise.all(["primary", "secondary", "other"].map((id) => store.getById(id)));
    expect(
      all
        .flatMap((transfer) => transfer?.files ?? [])
        .map((file) => file.id)
        .toSorted(),
    ).toEqual(["other-0", "primary-0", "secondary-0"]);
  });

  it("does not lose files or exceed caps when two secondaries race into one primary", async () => {
    const { transfers, input, store } = await fixture(sealed("primary", 1, { maxFiles: 2 }));
    await store.save(sealed("other"));
    const other = {
      ...input,
      body: { secondaryTransferId: "other", secondaryAgentToken: "other-private" },
    };
    const results = await Promise.all([transfers.merge(input), transfers.merge(other)]);
    expect(results.filter((result) => "movedFileCount" in result)).toHaveLength(1);
    expect((await store.getById("primary"))?.files).toHaveLength(2);
    const failed = "code" in results[0] ? input : other;
    expect(await transfers.merge(failed)).toMatchObject({ code: "too_many" });
    const all = await Promise.all(["primary", "secondary", "other"].map((id) => store.getById(id)));
    expect(all.flatMap((transfer) => transfer?.files ?? [])).toHaveLength(3);
  });

  it("exposes the same merge through the single MCP tool", async () => {
    const { transfers } = await fixture();
    const tool = createSharemeatsackTool(transfers);
    expect(
      await tool.invoke({
        action: "merge",
        transferId: "primary",
        agentToken: "primary-private",
        secondaryTransferId: "secondary",
        secondaryAgentToken: "secondary-private",
      }),
    ).toMatchObject({ movedFileCount: 1, totalFileCount: 2 });
  });
});
