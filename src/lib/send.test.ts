import { describe, expect, it } from "vitest";
import { FILE_MAX_BYTES } from "./schema";
import { createMemoryObjectStore } from "./object-store";
import { createMemoryTransferStore } from "./transfer-store";
import { createSharemeatsackTool } from "./sharemeatsack-tool";
import {
  createTransferService,
  humanScreenFor,
  isTransferServiceError,
  uploadPageCopy,
  type CreateSendResult,
} from "./transfers";

function sendService() {
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

const twoFiles = [
  { name: "one.pdf", type: "application/pdf", size: 4 },
  { name: "two.pdf", type: "application/pdf", size: 5 },
];

describe("B1 — agent starts a send", () => {
  it("creates a send with per-file upload URLs and a download link that is not ready", async () => {
    const { transfers } = sendService();
    const created = await transfers.create({
      action: "send",
      title: "For Simon",
      files: twoFiles,
    });
    expect(isTransferServiceError(created)).toBe(false);
    if (isTransferServiceError(created)) {
      return;
    }
    expect(created.kind).toBe("send");
    if (created.kind !== "send") {
      return;
    }
    expect(created.status).toBe("open");
    expect(created.downloadUrl).toContain("/s/transfer-1?t=token-1");
    expect(created.downloadUrl).not.toContain("token-2");
    expect(created.files).toHaveLength(2);
    expect(created.files[0]?.uploadUrl).toMatch(/^\/api\/v1\/objects\//);
    const publicView = await transfers.getForPublic({
      transferId: "transfer-1",
      publicToken: "token-1",
    });
    expect(humanScreenFor(publicView)).toBe("not_ready");
    expect(publicView).toMatchObject({ files: [] });
    expect(uploadPageCopy("not_ready").heading).toBe("These files are not ready yet");
  });

  it("refuses an empty file list and creates nothing", async () => {
    const { transfers, store } = sendService();
    const refused = await transfers.create({ action: "send", title: "For Simon", files: [] });
    expect(refused).toMatchObject({ code: "invalid_request", status: 400 });
    expect(await store.getById("transfer-1")).toBeNull();
  });

  it("refuses a 6 GiB offer and never mints a URL", async () => {
    const { transfers, store } = sendService();
    const refused = await transfers.create({
      action: "send",
      title: "For Simon",
      files: [{ name: "huge.bin", type: "application/octet-stream", size: FILE_MAX_BYTES + 1 }],
    });
    expect(refused).toMatchObject({ code: "too_large", status: 400 });
    expect(refused).not.toHaveProperty("files");
    expect(await store.getById("transfer-1")).toBeNull();
  });
});

describe("B2 — agent puts the bytes itself", () => {
  it("stays open until every offered file has arrived", async () => {
    const { transfers, objectStore, store } = sendService();
    const created = await transfers.create({
      action: "send",
      title: "For Simon",
      files: twoFiles,
    });
    if (isTransferServiceError(created)) {
      throw new Error("expected create");
    }
    const first = (await store.getById("transfer-1"))?.files?.[0];
    if (!first?.key) {
      throw new Error("expected key");
    }
    await objectStore.put(first.key, new Uint8Array(first.size), first.contentType);
    const partial = await transfers.complete({
      transferId: "transfer-1",
      agentToken: "token-2",
    });
    expect(partial).toMatchObject({ code: "incomplete_upload", status: 409 });
    const status = await transfers.getForAgent({
      transferId: "transfer-1",
      agentToken: "token-2",
    });
    expect(status).toMatchObject({ status: "open", files: [] });
  });

  it("becomes ready after every PUT and does not serve the public token a refresh", async () => {
    const { transfers, objectStore, store } = sendService();
    await transfers.create({ action: "send", title: "For Simon", files: twoFiles });
    const saved = await store.getById("transfer-1");
    for (const file of saved?.files ?? []) {
      if (!file.key) {
        throw new Error("expected key");
      }
      await objectStore.put(file.key, new Uint8Array(file.size), file.contentType);
    }
    const sealed = await transfers.complete({
      transferId: "transfer-1",
      agentToken: "token-2",
    });
    expect(sealed).toMatchObject({ status: "ready" });
    const agent = await transfers.getForAgent({
      transferId: "transfer-1",
      agentToken: "token-2",
    });
    expect(agent).toMatchObject({
      status: "ready",
      files: [{ name: "one.pdf" }, { name: "two.pdf" }],
    });
    if (isTransferServiceError(agent)) {
      throw new Error("expected agent view");
    }
    expect(agent.files[0]?.downloadUrl).toMatch(/^\/api\/v1\/objects\//);
    const person = await transfers.getForPublic({
      transferId: "transfer-1",
      publicToken: "token-1",
    });
    expect(humanScreenFor(person)).toBe("ready");
    if (isTransferServiceError(person)) {
      throw new Error("expected public view");
    }
    expect(person.files).toHaveLength(2);
    expect(person.files[0]?.downloadUrl).toBeTruthy();
    const refresh = await transfers.refreshUploadUrl({
      transferId: "transfer-1",
      fileId: "file-1",
      publicToken: "token-1",
    });
    expect(refresh).toMatchObject({ code: "not_found", status: 404 });
  });

  it("lets the agent refresh a PUT URL while the send is still open", async () => {
    const { transfers } = sendService();
    const created = await transfers.create({
      action: "send",
      title: "For Simon",
      files: [twoFiles[0]!],
    });
    if (isTransferServiceError(created) || created.kind !== "send") {
      throw new Error("expected create");
    }
    const refreshed = await transfers.refreshUploadUrl({
      transferId: "transfer-1",
      fileId: "file-1",
      agentToken: "token-2",
    });
    if (isTransferServiceError(refreshed)) {
      throw new Error("expected refresh");
    }
    expect(refreshed.uploadUrl).not.toBe(created.files[0]?.uploadUrl);
  });
});

describe("B7 / B8 — cancel and token split on a send", () => {
  it("lets the agent cancel a ready send and refuses the public token", async () => {
    const { transfers, objectStore, store } = sendService();
    await transfers.create({ action: "send", title: "For Simon", files: [twoFiles[0]!] });
    const saved = await store.getById("transfer-1");
    const file = saved?.files?.[0];
    if (!file?.key) {
      throw new Error("expected key");
    }
    await objectStore.put(file.key, new Uint8Array(file.size), file.contentType);
    await transfers.complete({ transferId: "transfer-1", agentToken: "token-2" });
    const asPerson = await transfers.cancel({
      transferId: "transfer-1",
      publicToken: "token-1",
    });
    expect(asPerson).toMatchObject({ code: "not_found", status: 404 });
    const cancelled = await transfers.cancel({
      transferId: "transfer-1",
      agentToken: "token-2",
    });
    expect(cancelled).toMatchObject({ status: "cancelled" });
  });
});

describe("B1 — tool send matches HTTP", () => {
  it("returns the same send as the HTTP service", async () => {
    const viaTool = sendService();
    const viaHttp = sendService();
    const tool = createSharemeatsackTool(viaTool.transfers);
    const fromTool = await tool.invoke({
      action: "send",
      title: "For Simon",
      files: twoFiles,
    });
    const fromHttp = await viaHttp.transfers.create({
      action: "send",
      title: "For Simon",
      files: twoFiles,
    });
    expect(isTransferServiceError(fromTool)).toBe(false);
    expect(isTransferServiceError(fromHttp)).toBe(false);
    if (isTransferServiceError(fromTool) || isTransferServiceError(fromHttp)) {
      return;
    }
    const toolSend = fromTool as CreateSendResult;
    if (toolSend.kind !== "send" || fromHttp.kind !== "send") {
      throw new Error("expected send");
    }
    expect(toolSend.transferId).toBe(fromHttp.transferId);
    expect(toolSend.downloadUrl).toBe(fromHttp.downloadUrl);
    expect(
      toolSend.files.map((file) => ({ id: file.id, name: file.name, uploadUrl: file.uploadUrl })),
    ).toEqual(
      fromHttp.files.map((file) => ({ id: file.id, name: file.name, uploadUrl: file.uploadUrl })),
    );
  });
});
