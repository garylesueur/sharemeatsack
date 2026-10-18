import { describe, expect, it, vi } from "vitest";
import { createLibraryService } from "./library";
import { createMemoryObjectStore } from "./object-store";
import { createMemoryCleanroom } from "./cleanroom";
import { type LibraryFile, type LibraryMetadata, LibraryError } from "./library-metadata";

function fixture(
  options: { hold?: boolean; infected?: boolean; scannerUnavailable?: boolean } = {},
) {
  let clock = new Date("2026-10-07T12:00:00Z");
  const files = new Map<string, LibraryFile>();
  const objects = createMemoryObjectStore(() => clock);
  const scanner = createMemoryCleanroom({
    hold: options.hold,
    verdictFor: () =>
      options.infected
        ? { verdict: "infected", signature: "test signature" }
        : { verdict: "clean" },
  });
  const metadata: LibraryMetadata = {
    call: vi.fn(async (operation, input) => {
      const id = String(input.id);
      const file = files.get(id);
      if (operation === "garbage")
        return [...files.values()].filter(
          (row) => !row.visible && row.uploadExpiresAt <= clock.getTime() && !row.references.length,
        );
      if (operation === "list")
        return {
          files: [...files.values()].filter((row) => row.visible),
          usedBytes: [...files.values()].reduce((total, row) => total + row.size, 0),
          allowanceBytes: 1_000_000_000,
          nextCursor: null,
        };
      if (operation === "reserve") {
        if (file) {
          if (
            !file.visible ||
            file.name !== input.name ||
            file.contentType !== input.contentType ||
            file.size !== input.size
          )
            throw new LibraryError("conflict", 409);
          return { ...file };
        }
        const row: LibraryFile = {
          id,
          accountId: "owner",
          name: String(input.name),
          contentType: String(input.contentType),
          size: Number(input.size),
          uploadKey: `sharemeatsack/library/${id}/upload`,
          createdAt: clock.getTime(),
          uploadExpiresAt: clock.getTime() + 3_600_000,
          visible: true,
          state: "uploading",
          references: [],
        };
        files.set(id, row);
        return { ...row };
      }
      if (!file) throw new LibraryError("not_found", 404);
      if (operation === "get") return { ...file };
      if (operation === "beginSeal") {
        if (file.state !== "uploading") throw new LibraryError("upload_not_open", 409);
        file.state = "sealing";
        file.scanAttemptId = String(input.attemptId);
        file.objectKey = `sharemeatsack/library/${id}/sealed/${file.scanAttemptId}`;
        return { ...file };
      }
      if (operation === "startScan") {
        if (!file.visible || file.state !== "sealing")
          throw new LibraryError("seal_not_verified", 409);
        file.state = "scanning";
        file.scanHandle = input.handle ? String(input.handle) : undefined;
        return true;
      }
      if (operation === "applyScan") {
        if (!file.visible || file.state !== "scanning" || file.scanAttemptId !== input.attemptId)
          return false;
        file.scanStatus = input.status as LibraryFile["scanStatus"];
        file.scanReason = input.reason as string | undefined;
        file.state =
          input.status === "clean" || input.status === "skipped-too-large"
            ? "available"
            : "blocked";
        return true;
      }
      if (operation === "failSeal") {
        if (file.state === "sealing") {
          file.state = "blocked";
          file.scanStatus = "failed";
        }
        return true;
      }
      if (operation === "remove") {
        file.state = "removing";
        file.visible = false;
        return { ...file };
      }
      if (operation === "release") {
        if (file.references.length || file.uploadExpiresAt > clock.getTime()) return false;
        files.delete(id);
        return true;
      }
      throw new Error("Unexpected operation");
    }),
  };
  const serviceFor = (accountId: string) =>
    createLibraryService({
      accountId,
      metadata,
      objects,
      scanner: options.scannerUnavailable ? null : scanner,
      baseUrl: "https://share.example",
      callbackUrl: "https://share.example/api/v1/library/scan-result",
      now: () => clock,
    });
  const service = serviceFor("owner");
  async function upload() {
    const offered = await service.offer({ name: "receipt.txt", type: "text/plain", size: 4 });
    const file = files.get(offered.file.id)!;
    await objects.put(file.uploadKey, new TextEncoder().encode("safe"), "text/plain");
    return { offered, file };
  }
  return {
    files,
    objects,
    scanner,
    metadata,
    service,
    serviceFor,
    upload,
    expire: () => {
      clock = new Date(clock.getTime() + 3_600_001);
    },
  };
}
describe("Share My files — private storage and scan orchestration", () => {
  it("reuses an upload reservation after a lost offer response without renewing its deadline or charging twice", async () => {
    const f = fixture();
    const input = {
      id: "8b41a139-af75-4c49-a7a6-963e8a78cacf",
      name: "receipt.txt",
      type: "text/plain",
      size: 4,
    };
    const first = await f.service.offer(input);
    const second = await f.service.offer(input);
    expect(first.file.id).toBe(input.id);
    expect(second.file.id).toBe(input.id);
    expect(f.files.size).toBe(1);
    expect((await f.service.list({ limit: 50, cursor: null })).usedBytes).toBe(4);
    f.expire();
    await expect(f.service.offer(input)).rejects.toMatchObject({ code: "upload_not_open" });
    expect(f.files.get(input.id)?.uploadExpiresAt).toBe(new Date("2026-10-07T13:00:00Z").getTime());
  });
  it("refuses a replayed offer for a sealed or changed file", async () => {
    const f = fixture();
    const { file } = await f.upload();
    await f.service.complete(file.id);
    await expect(
      f.service.offer({ id: file.id, name: file.name, type: file.contentType, size: file.size }),
    ).rejects.toMatchObject({ code: "upload_not_open" });
    await expect(
      f.service.offer({
        id: file.id,
        name: "changed.txt",
        type: file.contentType,
        size: file.size,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(f.files.size).toBe(1);
    expect(file.state).toBe("available");
  });
  it("returns private metadata only, seals original bytes and restores readable files on a later service instance", async () => {
    const f = fixture();
    const { file, offered } = await f.upload();
    expect(offered.uploadUrl).toMatch(/^https:\/\/share.example\//);
    expect(offered.file).not.toHaveProperty("accountId");
    expect(offered.file).not.toHaveProperty("uploadKey");
    const complete = await f.service.complete(file.id);
    expect(complete.state).toBe("available");
    expect(complete.scanStatus).toBe("clean");
    await f.objects.put(file.uploadKey, new TextEncoder().encode("evil"), "text/plain");
    expect(new TextDecoder().decode((await f.objects.get(file.objectKey!))!.body)).toBe("safe");
    const submitted = [...f.scanner.submitted.values()][0]!;
    expect(submitted.url).toContain(encodeURIComponent(file.scanAttemptId!));
    expect(submitted.url).not.toContain("/upload?");
    expect((await f.serviceFor("owner").list({ limit: 50, cursor: null })).files[0]?.id).toBe(
      file.id,
    );
    const read = await f.serviceFor("owner").readUrl(file.id, "download");
    expect(read.url).toContain("/sealed/");
    expect(read.url).not.toContain("/upload?");
    await expect(f.serviceFor("other").get(file.id)).rejects.toMatchObject({ status: 404 });
    await expect(f.serviceFor("other").readUrl(file.id, "download")).rejects.toMatchObject({
      status: 404,
    });
  });
  it("holds a pending scan, then unlocks it through the existing scanner poll", async () => {
    const f = fixture({ hold: true });
    const { file } = await f.upload();
    expect((await f.service.complete(file.id)).state).toBe("scanning");
    await expect(f.service.readUrl(file.id, "preview")).rejects.toMatchObject({
      code: "file_unavailable",
    });
    f.scanner.resolve(file.scanHandle!, { verdict: "clean" });
    expect((await f.service.get(file.id)).state).toBe("available");
  });
  it.each([
    { phase: "head", closedAccount: false },
    { phase: "head", closedAccount: true },
    { phase: "sign", closedAccount: false },
    { phase: "sign", closedAccount: true },
  ] as const)(
    "refuses a new read when authority ends during $phase (closed account: $closedAccount)",
    async ({ phase, closedAccount }) => {
      const f = fixture();
      const { file } = await f.upload();
      await f.service.complete(file.id);
      // Referenced bytes survive removal; object presence cannot establish read authority.
      file.references = ["existing-send"];
      let closed = false;
      const call = f.metadata.call;
      f.metadata.call = async (operation, input) => {
        if (closed) throw new LibraryError("unauthorized", 401);
        return call(operation, input);
      };
      const endAuthority = () => {
        if (closedAccount) closed = true;
        else {
          file.visible = false;
          file.state = "removing";
        }
      };
      const head = f.objects.head;
      if (phase === "head")
        f.objects.head = async (key) => {
          const result = await head(key);
          endAuthority();
          return result;
        };
      const presignGet = f.objects.presignGet;
      const sign = vi.spyOn(f.objects, "presignGet").mockImplementation(async (input) => {
        const result = await presignGet(input);
        if (phase === "sign") endAuthority();
        return result;
      });
      await expect(f.service.readUrl(file.id, "download")).rejects.toMatchObject({
        code: closedAccount ? "unauthorized" : "not_found",
      });
      expect(sign).toHaveBeenCalledTimes(phase === "head" ? 0 : 1);
      expect(await head(file.objectKey!)).not.toBeNull();
    },
  );
  it("blocks infection and scanner failure, never minting a read URL", async () => {
    await Promise.all(
      [{ infected: true }, { scannerUnavailable: true }].map(async (options) => {
        const f = fixture(options);
        const { file } = await f.upload();
        expect((await f.service.complete(file.id)).state).toBe("blocked");
        await expect(f.service.readUrl(file.id, "download")).rejects.toMatchObject({
          code: "file_unavailable",
        });
        if (options.infected) expect(await f.objects.head(file.objectKey!)).toBeNull();
      }),
    );
  });
  it("does not scan an incomplete upload and marks storage-copy failure blocked", async () => {
    const f = fixture();
    const { file } = await f.upload();
    await f.objects.put(file.uploadKey, new Uint8Array([1]), "text/plain");
    await expect(f.service.complete(file.id)).rejects.toMatchObject({ code: "incomplete_upload" });
    expect(f.scanner.submitted.size).toBe(0);
    await f.objects.put(file.uploadKey, new Uint8Array(4), "text/plain");
    vi.spyOn(f.objects, "copy").mockRejectedValue(new Error("storage outage"));
    await expect(f.service.complete(file.id)).rejects.toThrow("storage outage");
    expect(file.state).toBe("blocked");
    expect(f.scanner.submitted.size).toBe(0);
  });
  it("removes only the selected object, preserving references and holding reservations until upload expiry", async () => {
    const f = fixture();
    const first = await f.upload();
    const second = await f.upload();
    await f.service.complete(first.file.id);
    await f.service.complete(second.file.id);
    first.file.references = ["existing-send"];
    await f.service.remove(first.file.id);
    expect(await f.objects.head(first.file.objectKey!)).not.toBeNull();
    expect(await f.objects.head(second.file.objectKey!)).not.toBeNull();
    expect(
      (await f.service.list({ limit: 50, cursor: null })).files.map((file) => file.id),
    ).toEqual([second.file.id]);
    await expect(f.service.get(first.file.id)).rejects.toMatchObject({ status: 404 });
    await f.service.remove(second.file.id);
    expect(await f.objects.head(second.file.objectKey!)).toBeNull();
    expect(f.files.has(second.file.id)).toBe(true);
    f.expire();
    await f.service.list({ limit: 50, cursor: null });
    expect(f.files.has(second.file.id)).toBe(false);
    expect(f.files.has(first.file.id)).toBe(true);
  });
  it("does not delete a file when a stale scan result is refused", async () => {
    const f = fixture({ hold: true });
    const { file } = await f.upload();
    await f.service.complete(file.id);
    f.scanner.resolve(file.scanHandle!, { verdict: "infected", signature: "late" });
    const call = f.metadata.call.bind(f.metadata);
    f.metadata.call = async (operation, input) =>
      operation === "applyScan" ? false : call(operation, input);
    await f.service.get(file.id);
    expect(await f.objects.head(file.objectKey!)).not.toBeNull();
  });
  it("renews only a live staging upload and refuses missing storage before a quota reservation", async () => {
    const f = fixture();
    const { file } = await f.upload();
    expect((await f.service.retryUpload(file.id)).file.id).toBe(file.id);
    f.expire();
    await expect(f.service.retryUpload(file.id)).rejects.toMatchObject({ code: "upload_not_open" });
    const offline = createLibraryService({
      accountId: "owner",
      metadata: f.metadata,
      objects: null,
      scanner: null,
      baseUrl: "https://share.example",
      callbackUrl: "https://share.example/callback",
    });
    await expect(offline.offer({ name: "no.txt", size: 1 })).rejects.toMatchObject({
      code: "storage_unavailable",
    });
    expect(f.files.size).toBe(1);
  });
});
