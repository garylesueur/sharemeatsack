import { describe, expect, it, vi } from "vitest";
import { createMemoryObjectStore } from "./object-store";
import { createOwnedWorkspaceService } from "./owned-workspace";
import type { LibraryFile, LibraryMetadata } from "./library-metadata";
const id = "34e4a8ed-30c3-4f09-a0e8-5ff5ed605c28";
const attempt = "0ef37717-3c79-4db4-8ba9-fbeaa58a3d24";
const sourceKey = "sharemeatsack/owned/request/source/sealed/source-attempt";
function fixture(
  options: {
    committed?: boolean;
    loseSource?: boolean;
    mismatch?: boolean;
    sourceFailure?: boolean;
  } = {},
) {
  const objects = createMemoryObjectStore();
  const target: LibraryFile = {
    id,
    accountId: "owner",
    name: "response.txt",
    contentType: "text/plain",
    size: 4,
    uploadKey: `sharemeatsack/library/${id}/upload`,
    objectKey: `sharemeatsack/library/${id}/sealed/${attempt}`,
    createdAt: 1,
    uploadExpiresAt: 1,
    sealDeadlineAt: 120001,
    visible: !!options.committed,
    state: options.committed ? "available" : "sealing",
    scanStatus: "clean",
    scanAttemptId: attempt,
    references: [],
  };
  const call = vi.fn(async (operation: string) => {
    if (operation === "beginKeep")
      return { file: { ...target }, sourceKey, status: options.committed ? "kept" : "copying" };
    if (operation === "commitKeep") {
      if (options.loseSource) return null;
      target.visible = true;
      target.state = "available";
      return { ...target };
    }
    if (operation === "abortKeep")
      return { file: { ...target }, status: options.committed ? "kept" : "cleaning" };
    throw new Error("Unexpected operation");
  });
  const metadata: LibraryMetadata = { call };
  const service = createOwnedWorkspaceService({
    accountId: "owner",
    metadata,
    objects,
    baseUrl: "https://share.example",
  });
  return {
    objects,
    target,
    call,
    service,
    prepare: async () => {
      if (!options.sourceFailure)
        await objects.put(
          sourceKey,
          new TextEncoder().encode(options.mismatch ? "bad" : "safe"),
          "text/plain",
        );
    },
  };
}
describe("independent keeping at the storage boundary", () => {
  it("copies inside storage, verifies size, then commits with the authoritative attempt", async () => {
    const f = fixture();
    await f.prepare();
    expect(await f.service.keep("request", "source", { id })).toMatchObject({
      status: "kept",
      file: { id, state: "available" },
    });
    expect(f.call.mock.calls.map(([operation]) => operation)).toEqual(["beginKeep", "commitKeep"]);
    expect(f.call).toHaveBeenLastCalledWith("commitKeep", {
      accountId: "owner",
      transferId: "request",
      fileId: "source",
      id,
      attemptId: attempt,
      observedBytes: 4,
    });
    await f.objects.delete(sourceKey);
    expect(new TextDecoder().decode((await f.objects.get(f.target.objectKey!))!.body)).toBe("safe");
  });
  it("reconciles an already committed copy without reading or copying the source", async () => {
    const f = fixture({ committed: true, sourceFailure: true });
    const copy = vi.spyOn(f.objects, "copy");
    expect(await f.service.keep("request", "source", { id })).toMatchObject({ status: "kept" });
    expect(copy).not.toHaveBeenCalled();
    expect(f.call).toHaveBeenCalledOnce();
  });
  it("does not publish a completed storage copy after source authority is lost", async () => {
    const f = fixture({ loseSource: true });
    await f.prepare();
    await expect(f.service.keep("request", "source", { id })).rejects.toMatchObject({
      code: "file_unavailable",
    });
    expect(f.target.visible).toBe(false);
    expect(await f.objects.head(f.target.objectKey!)).toEqual({ size: 4 });
    // The authoritative commit queues this tracked key for safe scheduled cleanup.
    expect(f.call).toHaveBeenLastCalledWith(
      "commitKeep",
      expect.objectContaining({ observedBytes: 4 }),
    );
  });
  it("aborts a wrong-sized copy before attempting publication", async () => {
    const f = fixture({ mismatch: true });
    await f.prepare();
    await expect(f.service.keep("request", "source", { id })).rejects.toMatchObject({
      code: "file_unavailable",
    });
    expect(f.call.mock.calls.map(([operation]) => operation)).toEqual(["beginKeep", "abortKeep"]);
    expect(f.target.visible).toBe(false);
  });
  it("keeps uncertain failed storage work tracked for reconciliation rather than reporting success", async () => {
    const f = fixture({ sourceFailure: true });
    await expect(f.service.keep("request", "source", { id })).rejects.toThrow();
    expect(f.call.mock.calls.map(([operation]) => operation)).toEqual(["beginKeep"]);
    expect(f.target.visible).toBe(false);
  });
  it("explicit cancellation reconciles an already committed result instead of deleting it", async () => {
    const f = fixture({ committed: true });
    expect(await f.service.abortKeep("request", "source", { id })).toMatchObject({
      state: "kept",
      file: { id },
    });
    expect(f.target.visible).toBe(true);
  });
  it("returns only the public link from the authoritative first creation after retry", async () => {
    const call = vi.fn(async (_op: string, input: Record<string, unknown>) =>
      JSON.stringify({
        ...JSON.parse(String(input.transfer)),
        publicToken: "public-first",
        agentToken: "private-first",
        expiresAt: "2026-10-17T12:00:00.000Z",
        files: [],
      }),
    );
    const service = createOwnedWorkspaceService({
      accountId: "owner",
      metadata: { call },
      objects: null,
      baseUrl: "https://share.example",
      now: () => new Date("2026-10-10T12:00:00Z"),
    });
    const result = await service.createSend({ id, title: "Notes", libraryFileIds: ["source"] });
    expect(result).toEqual({
      id,
      publicUrl: `https://share.example/s/${id}?t=public-first`,
      expiresAt: "2026-10-17T12:00:00.000Z",
    });
    expect(JSON.stringify(result)).not.toContain("private-first");
    expect(call).toHaveBeenCalledWith(
      "createFromLibrary",
      expect.objectContaining({ accountId: "owner", libraryFileIds: ["source"] }),
    );
  });
});
