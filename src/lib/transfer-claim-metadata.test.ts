import { describe, expect, it, vi } from "vitest";
import { createTransferClaimMetadata } from "./transfer-claim-metadata";
const identity = {
  accountId: "account",
  sourceId: "legacy",
  attemptId: "6225b4ba-405e-49bc-8866-51bd8ecdd1e5",
  proofHash: "a".repeat(64),
  intentId: "intent",
  snapshotHash: "b".repeat(64),
  transfer: "{}",
};
const owned = {
  id: "legacy",
  ownerAccountId: "account",
  kind: "request",
  status: "open",
  title: "Original",
  createdAt: "2026-10-11T10:00:00Z",
  expiresAt: "2026-10-12T10:00:00Z",
  publicToken: "public",
  agentToken: "private",
  files: [],
};
const receipt = {
  state: "committed",
  sourceId: "legacy",
  id: "legacy",
  attemptId: identity.attemptId,
  snapshotHash: identity.snapshotHash,
  transfer: JSON.stringify(owned),
};
describe("Share exact native claim receipts", () => {
  it("routes fixed operations, keeps exact JSON, and distinguishes retired ownership from missing or malformed authority", async () => {
    const call = vi.fn().mockResolvedValue(receipt);
    const client = createTransferClaimMetadata({ call });
    expect(await client.claimTransfer(identity)).toEqual(receipt);
    expect(call).toHaveBeenCalledWith("claimTransfer", identity);
    call.mockResolvedValue(null);
    expect(
      await client.getClaim({
        accountId: "account",
        sourceId: "legacy",
        snapshotHash: identity.snapshotHash,
      }),
    ).toBeNull();
    expect(await client.owned("legacy")).toBeNull();
    call.mockResolvedValue({ retired: true });
    expect(await client.owned("legacy")).toBe("retired");
    call.mockResolvedValue(JSON.stringify(owned));
    expect(await client.owned("legacy")).toEqual(owned);
    call.mockResolvedValue(JSON.stringify({ ...owned, ownerAccountId: undefined }));
    await expect(client.owned("legacy")).rejects.toMatchObject({ code: "storage_unavailable" });
  });
  it("refuses foreign/malformed bindings or payloads and never interprets a null import reply as committed", async () => {
    await Promise.all(
      [
        null,
        { ...receipt, sourceId: "other" },
        { ...receipt, id: "other" },
        { ...receipt, attemptId: "6225b4ba-405e-49bc-8866-51bd8ecdd1e6" },
        { ...receipt, snapshotHash: "c".repeat(64) },
        { ...receipt, unexpected: true },
        { ...receipt, transfer: JSON.stringify({ ...owned, ownerAccountId: "other" }) },
        { ...receipt, transfer: "broken" },
      ].map(async (result) => {
        const client = createTransferClaimMetadata({ call: async () => result });
        await expect(client.claimTransfer(identity)).rejects.toThrow();
      }),
    );
    const client = createTransferClaimMetadata({
      call: async () => ({ ...receipt, transfer: null }),
    });
    expect(await client.claimTransfer(identity)).toEqual({ ...receipt, transfer: null });
  });
});
