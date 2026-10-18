import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createMemoryObjectStore } from "./object-store";
import { ownedTransferCleanupRequest } from "./owned-transfer-cleanup";
const now = Date.parse("2026-10-10T12:00:00Z");
const secret = "test-service-signing-material";
const target = {
  id: "file",
  uploadKey: "sharemeatsack/owned/transfer/file/upload",
  objectKey: "sharemeatsack/owned/transfer/file/sealed/attempt",
  cleanupAt: now - 1,
};
function incoming(domain = "transfer-cleanup") {
  const body = JSON.stringify({ id: "file" });
  const seconds = now / 1000;
  const sig = createHmac("sha256", secret).update(`${seconds}.${domain}.${body}`).digest("hex");
  return new Request("https://share.example/api/v1/transfers/cleanup", {
    method: "POST",
    headers: { "transfer-cleanup-signature": `t=${seconds},v1=${sig}` },
    body,
  });
}
describe("owned transfer scheduled storage deletion", () => {
  it("removes only frozen authorised keys and verifies absence before success", async () => {
    const objects = createMemoryObjectStore();
    await objects.put(target.uploadKey, new Uint8Array([1]), "text/plain");
    await objects.put(target.objectKey, new Uint8Array([1]), "text/plain");
    await objects.put("unrelated", new Uint8Array([2]), "text/plain");
    const call = vi.fn(async () => target);
    const response = await ownedTransferCleanupRequest(incoming(), {
      secret,
      metadata: { call },
      objects,
      now: () => now,
    });
    expect(await response.json()).toEqual({ ok: true });
    expect(call).toHaveBeenCalledTimes(2);
    expect(await objects.head(target.uploadKey)).toBeNull();
    expect(await objects.head(target.objectKey)).toBeNull();
    expect(await objects.head("unrelated")).toEqual({ size: 1 });
  });
  it("refuses scan/library/store signature domains", async () => {
    const call = vi.fn();
    expect(
      (
        await ownedTransferCleanupRequest(incoming("library-cleanup"), {
          secret,
          metadata: { call },
          objects: null,
          now: () => now,
        })
      ).status,
    ).toBe(401);
    expect(call).not.toHaveBeenCalled();
  });
  it.each([
    { ...target, uploadKey: "sharemeatsack/owned/transfer/another/upload" },
    { ...target, objectKey: "sharemeatsack/library/file/sealed/attempt" },
    { ...target, cleanupAt: now + 1 },
  ])("refuses unsafe or premature storage authority (%j)", async (value) => {
    const objects = createMemoryObjectStore();
    const remove = vi.spyOn(objects, "delete");
    expect(
      (
        await ownedTransferCleanupRequest(incoming(), {
          secret,
          metadata: { call: async () => value },
          objects,
          now: () => now,
        })
      ).status,
    ).toBe(503);
    expect(remove).not.toHaveBeenCalled();
  });
  it("stops if cleanup authority changes before deletion", async () => {
    const objects = createMemoryObjectStore();
    const remove = vi.spyOn(objects, "delete");
    const call = vi.fn().mockResolvedValueOnce(target).mockResolvedValueOnce(null);
    expect(
      (
        await ownedTransferCleanupRequest(incoming(), {
          secret,
          metadata: { call },
          objects,
          now: () => now,
        })
      ).status,
    ).toBe(409);
    expect(remove).not.toHaveBeenCalled();
  });
  it("does not report success when storage retains an object", async () => {
    const objects = createMemoryObjectStore();
    await objects.put(target.objectKey, new Uint8Array([1]), "text/plain");
    vi.spyOn(objects, "delete").mockResolvedValue();
    expect(
      (
        await ownedTransferCleanupRequest(incoming(), {
          secret,
          metadata: { call: async () => target },
          objects,
          now: () => now,
        })
      ).status,
    ).toBe(503);
  });
});
