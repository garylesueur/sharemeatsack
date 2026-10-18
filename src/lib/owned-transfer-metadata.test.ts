import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createOwnedTransferMetadata } from "./owned-transfer-metadata";

describe("owned transfer storage transport", () => {
  it("signs the exact payload in a separate domain and fixes the destination", async () => {
    const now = new Date("2026-10-10T12:00:00Z");
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const payload = String(init?.body);
      const expected = createHmac("sha256", "test-signing-material")
        .update(`${Math.floor(now.getTime() / 1000)}.sharemeatsack-account-store.${payload}`)
        .digest("hex");
      expect(new Headers(init?.headers).get("transfer-store-signature")).toBe(
        `t=${Math.floor(now.getTime() / 1000)},v1=${expected}`,
      );
      expect(init?.redirect).toBe("error");
      expect(init?.cache).toBe("no-store");
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
      return Response.json(null);
    });
    const metadata = createOwnedTransferMetadata({
      origin: "https://lanyard.example/base",
      secret: "test-signing-material",
      fetch: fetcher,
      now: () => now,
    });
    expect(await metadata.call("getById", { id: "record" })).toBeNull();
    expect(String(fetcher.mock.calls[0][0])).toBe("https://lanyard.example/api/v1/transfers/store");
  });
  it("keeps storage refusal distinct from a missing record", async () => {
    const metadata = createOwnedTransferMetadata({
      origin: "https://lanyard.example",
      secret: "test",
      fetch: async () => Response.json({ error: "not_found" }, { status: 404 }),
    });
    await expect(metadata.call("getById", { id: "record" })).rejects.toMatchObject({
      code: "not_found",
      status: 404,
    });
  });
  it("fails before networking when service configuration is unavailable", async () => {
    const fetcher = vi.fn();
    const metadata = createOwnedTransferMetadata({ origin: "", secret: "", fetch: fetcher });
    await expect(metadata.call("save", { transfer: "{}" })).rejects.toMatchObject({
      code: "unavailable",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

it("bounds streamed private claim receipts before parsing and keeps native refusal explicit", async () => {
  const huge = createOwnedTransferMetadata({
    origin: "https://portal.example",
    secret: "test",
    fetch: async () => new Response(" ".repeat(512001)),
  });
  await expect(huge.call("getClaim", {})).rejects.toThrow();
  const refused = createOwnedTransferMetadata({
    origin: "https://portal.example",
    secret: "test",
    fetch: async () => Response.json({ error: "claim_files_unsupported" }, { status: 409 }),
  });
  await expect(refused.call("claimTransfer", {})).rejects.toMatchObject({
    code: "claim_files_unsupported",
    status: 409,
  });
});
