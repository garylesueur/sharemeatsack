/* eslint-disable no-await-in-loop -- Sequential overlay refusals on one frozen source fixture. */
import { describe, expect, it, vi } from "vitest";
import { createOwnedTransferStore } from "./owned-transfer-store";
import { createMemoryTransferStore, type TransferStore, type Transfer } from "./transfer-store";
const value: Transfer = {
  id: "legacy",
  kind: "request",
  status: "open",
  title: "Legacy",
  createdAt: "2026-10-11T10:00:00Z",
  expiresAt: "2026-10-12T10:00:00Z",
  publicToken: "public",
  agentToken: "private",
  files: [],
};
function setup() {
  const legacy = createMemoryTransferStore();
  const read = vi.fn<() => Promise<unknown>>().mockResolvedValue(null);
  const store = createOwnedTransferStore({ legacy, metadata: { call: read } });
  return { store, legacy, read };
}
describe("Share paired source claim capabilities", () => {
  it("requires definitive native absence and refuses live/retired/unknown overlays or outage before freezing", async () => {
    const f = setup();
    await f.legacy.save(value);
    for (const overlay of [
      { retired: true },
      JSON.stringify({ ...value, ownerAccountId: "account" }),
      undefined,
      false,
    ]) {
      f.read.mockResolvedValue(overlay);
      expect(
        await f.store.beginClaim!(value.id, "account", "attempt", value.agentToken),
      ).toBeNull();
      expect(await f.legacy.inspectClaim!(value.id, "account", "attempt")).toBe("none");
    }
    f.read.mockRejectedValue(new Error("offline"));
    await expect(
      f.store.beginClaim!(value.id, "account", "attempt", value.agentToken),
    ).rejects.toThrow("offline");
    await f.legacy.delete(value.id);
  });
  it("forwards proof fences and always resolves underlying sources after native publication/retirement", async () => {
    const f = setup();
    await f.legacy.save(value);
    expect(await f.store.beginClaim!(value.id, "account", "attempt", value.publicToken)).toBeNull();
    expect(await f.store.beginClaim!(value.id, "account", "attempt", value.agentToken)).toEqual({
      snapshot: JSON.stringify(value),
    });
    f.read.mockResolvedValue({ retired: true });
    expect(await f.store.inspectClaim!(value.id, "account", "attempt")).toBe("pending");
    expect(await f.store.resolveClaim!(value.id, "other", "attempt", "committed")).toBe(false);
    expect(await f.store.resolveClaim!(value.id, "account", "attempt", "committed")).toBe(true);
    expect(await f.store.inspectClaim!(value.id, "account", "attempt")).toBe("committed");
    expect(await f.legacy.getById(value.id)).toBeNull();
    await expect(f.legacy.save(value)).rejects.toThrow("fenced");
  });
  it("requires all three capabilities and preserves their bound source identity", () => {
    const f = setup();
    for (const missing of ["beginClaim", "resolveClaim", "inspectClaim"] as const) {
      const partial: TransferStore = { ...f.legacy, [missing]: undefined };
      const store = createOwnedTransferStore({
        legacy: partial,
        metadata: { call: async () => null },
      });
      expect(store.beginClaim).toBeUndefined();
      expect(store.resolveClaim).toBeUndefined();
      expect(store.inspectClaim).toBeUndefined();
    }
  });
});
