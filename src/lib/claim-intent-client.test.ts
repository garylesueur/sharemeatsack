import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createClaimIntentClient } from "./claim-intent-client";
const identity = {
  accountId: "account",
  sourceId: "source",
  attemptId: "6225b4ba-405e-49bc-8866-51bd8ecdd1e5",
  proofHash: "a".repeat(64),
};
const intent = {
  ...identity,
  intentId: "intent",
  product: "sharemeatsack",
  state: "prepared",
  createdAt: 1000,
  deadlineAt: 901000,
  sourceResolved: false,
};
describe("Share product-signed durable claim intent client", () => {
  it("sends a hash-only private body and accepts the original attempt on preparation retries", async () => {
    const send = vi.fn(async (_: unknown, request?: RequestInit) => {
      const body = String(request?.body);
      expect(JSON.parse(body)).toEqual({
        product: "sharemeatsack",
        operation: "prepare",
        input: identity,
      });
      expect(new Headers(request?.headers).get("claim-store-signature")).toBe(
        `t=1,v1=${createHmac("sha256", "synthetic-secret").update(`1.claim-store.${body}`).digest("hex")}`,
      );
      expect(request).toMatchObject({ method: "POST", cache: "no-store", redirect: "error" });
      return Response.json({ ...intent, attemptId: "6225b4ba-405e-49bc-8866-51bd8ecdd1e6" });
    });
    const client = createClaimIntentClient({
      origin: "http://localhost:3040",
      secret: "synthetic-secret",
      fetch: send,
      now: () => 1000,
    });
    expect(await client.prepare(identity)).toMatchObject({
      intentId: "intent",
      attemptId: "6225b4ba-405e-49bc-8866-51bd8ecdd1e6",
    });
  });
  it("refuses foreign, malformed and oversized receipts before source fencing", async () => {
    await Promise.all(
      [
        { ...intent, product: "askmeatsack" },
        { ...intent, accountId: "foreign" },
        { ...intent, sourceId: "foreign" },
        { ...intent, proofHash: "b".repeat(64) },
        { ...intent, attemptId: "invalid" },
        { ...intent, unexpected: "x" },
      ].map(async (receipt) => {
        const client = createClaimIntentClient({
          origin: "https://portal.example",
          secret: "synthetic-secret",
          fetch: vi.fn().mockResolvedValue(Response.json(receipt)),
        });
        await expect(client.prepare(identity)).rejects.toMatchObject({
          code: "storage_unavailable",
        });
      }),
    );
    const client = createClaimIntentClient({
      origin: "https://portal.example",
      secret: "synthetic-secret",
      fetch: vi.fn().mockResolvedValue(new Response(" ".repeat(8193))),
    });
    await expect(client.prepare(identity)).rejects.toMatchObject({ code: "storage_unavailable" });
  });
  it("binds status/cancellation to the selected original intent and never treats an unavailable read as abort", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ...intent, intentId: "wrong" }))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(Response.json(null));
    const client = createClaimIntentClient({
      origin: "https://portal.example",
      secret: "synthetic-secret",
      fetch: send,
    });
    const binding = { ...identity, intentId: "intent" };
    await expect(client.get(binding)).rejects.toMatchObject({ code: "storage_unavailable" });
    await expect(client.cancel(binding)).rejects.toMatchObject({ code: "storage_unavailable" });
    expect(await client.get(binding)).toBeNull();
  });
  it("refuses invalid bindings or destinations without sending credentials", async () => {
    const send = vi.fn();
    const client = createClaimIntentClient({
      origin: "http://localhost:3040",
      secret: "synthetic-secret",
      fetch: send,
    });
    await expect(client.prepare({ ...identity, proofHash: "raw-proof" })).rejects.toMatchObject({
      code: "storage_unavailable",
    });
    expect(send).not.toHaveBeenCalled();
    expect(() =>
      createClaimIntentClient({
        origin: "http://external.example",
        secret: "synthetic-secret",
        fetch: send,
      }),
    ).toThrow();
    expect(() =>
      createClaimIntentClient({
        origin: "https://user:password@external.example",
        secret: "synthetic-secret",
        fetch: send,
      }),
    ).toThrow();
  });
});
