import { describe, expect, it } from "vitest";
import {
  TRANSFER_DEFAULT_TTL_SECONDS,
  TRANSFER_MAX_TTL_SECONDS,
  WAIT_BUDGET_SECONDS,
  WAIT_MAX_SECONDS,
} from "./schema";
import { createMemoryTransferStore } from "./transfer-store";
import {
  createTransferService,
  humanScreenFor,
  isTransferServiceError,
  uploadPageCopy,
} from "./transfers";

function service() {
  const store = createMemoryTransferStore();
  const created = new Date("2026-09-19T12:00:00.000Z");
  return {
    store,
    created,
    transfers: createTransferService({
      store,
      now: () => created,
      createId: () => "transfer-1",
      createToken: (() => {
        let n = 0;
        return () => `token-${++n}`;
      })(),
    }),
  };
}

describe("B1 — agent starts a request", () => {
  it("creates a request and returns three links without the agent secret on uploadUrl", async () => {
    const { transfers } = service();
    const result = await transfers.createRequest({ action: "request", title: "Invoices" });
    expect(isTransferServiceError(result)).toBe(false);
    if (isTransferServiceError(result)) {
      return;
    }
    expect(result.transferId).toBe("transfer-1");
    expect(result.status).toBe("open");
    expect(result.uploadUrl).toContain("/s/transfer-1?t=token-1");
    expect(result.uploadUrl).not.toContain("token-2");
    expect(result.pollUrl).toContain("token-2");
    expect(result.manageUrl).toContain("token-2");
    expect(result.expiresAt).toBe(
      new Date(
        Date.parse("2026-09-19T12:00:00.000Z") + TRANSFER_DEFAULT_TTL_SECONDS * 1000,
      ).toISOString(),
    );
  });

  it("refuses a missing title and creates nothing", async () => {
    const { transfers, store } = service();
    const result = await transfers.createRequest({ action: "request" });
    expect(isTransferServiceError(result)).toBe(true);
    if (!isTransferServiceError(result)) {
      return;
    }
    expect(result.status).toBe(400);
    expect(result.code).toBe("invalid_request");
    expect(await store.getById("transfer-1")).toBeNull();
  });

  it("refuses an expiry later than 30 days and creates nothing", async () => {
    const { transfers, store } = service();
    const result = await transfers.createRequest({
      action: "request",
      title: "Invoices",
      expiresInSeconds: TRANSFER_MAX_TTL_SECONDS + 1,
    });
    expect(isTransferServiceError(result)).toBe(true);
    expect(await store.getById("transfer-1")).toBeNull();
  });

  it("gives two creates different ids and tokens", async () => {
    const store = createMemoryTransferStore();
    let ids = 0;
    let tokens = 0;
    const transfers = createTransferService({
      store,
      now: () => new Date("2026-09-19T12:00:00.000Z"),
      createId: () => `id-${++ids}`,
      createToken: () => `tok-${++tokens}`,
    });
    const first = await transfers.createRequest({ title: "One" });
    const second = await transfers.createRequest({ title: "Two" });
    if (isTransferServiceError(first) || isTransferServiceError(second)) {
      throw new Error("expected creates");
    }
    expect(first.transferId).not.toBe(second.transferId);
    expect(first.uploadUrl).not.toBe(second.uploadUrl);
    expect(first.pollUrl).not.toBe(second.pollUrl);
  });
});

describe("B8 / B9 — tokens do not leak another request", () => {
  it("hides an unknown id and a mismatched public token the same way", async () => {
    const { transfers } = service();
    await transfers.createRequest({ title: "Invoices" });
    const unknown = await transfers.loadForPublic("missing", "token-1");
    const wrong = await transfers.loadForPublic("transfer-1", "other");
    const right = await transfers.loadForPublic("transfer-1", "token-1");
    expect(isTransferServiceError(unknown)).toBe(true);
    expect(isTransferServiceError(wrong)).toBe(true);
    if (isTransferServiceError(unknown) && isTransferServiceError(wrong)) {
      expect(unknown.status).toBe(404);
      expect(wrong.status).toBe(404);
      expect(unknown.message).toBe(wrong.message);
    }
    expect(isTransferServiceError(right)).toBe(false);
  });

  it("does not let the public token act as the agent", async () => {
    const { transfers } = service();
    await transfers.createRequest({ title: "Invoices" });
    const asAgent = await transfers.loadForAgent("transfer-1", "token-1");
    expect(isTransferServiceError(asAgent)).toBe(true);
  });
});

function waitingService() {
  let now = new Date("2026-09-19T12:00:00.000Z");
  const store = createMemoryTransferStore();
  const transfers = createTransferService({
    store,
    now: () => now,
    createId: () => "transfer-1",
    createToken: (() => {
      let n = 0;
      return () => `token-${++n}`;
    })(),
    sleep: async (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  });
  return {
    store,
    transfers,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  };
}

describe("B4 — agent can wait a bounded time", () => {
  it("returns the current open status with nextAction wait when the bound ends", async () => {
    const { transfers } = waitingService();
    await transfers.createRequest({ title: "Invoices" });
    const waited = await transfers.wait({
      transferId: "transfer-1",
      agentToken: "token-2",
      seconds: 2,
    });
    expect(waited).toMatchObject({
      status: "open",
      timedOut: true,
      nextAction: "wait",
    });
  });

  it("stops short of the function limit however long the agent asked for", async () => {
    const { transfers } = waitingService();
    await transfers.createRequest({ title: "Invoices" });
    const waited = await transfers.wait({
      transferId: "transfer-1",
      agentToken: "token-2",
      seconds: WAIT_MAX_SECONDS,
    });
    expect(waited).toMatchObject({
      timedOut: true,
      waitedSeconds: WAIT_BUDGET_SECONDS,
      nextAction: "wait",
    });
  });

  it("returns a terminal result without nextAction when the request completes in time", async () => {
    const { transfers, store } = waitingService();
    await transfers.createRequest({ title: "Invoices" });
    const open = await store.getById("transfer-1");
    if (!open) {
      throw new Error("expected transfer");
    }
    await store.save({ ...open, status: "complete", completedAt: open.createdAt });
    const waited = await transfers.wait({
      transferId: "transfer-1",
      agentToken: "token-2",
      seconds: 30,
    });
    expect(waited).toMatchObject({ status: "complete", timedOut: false, waitedSeconds: 0 });
    expect(waited).not.toHaveProperty("nextAction");
  });

  it("does not let the public token wait", async () => {
    const { transfers } = waitingService();
    await transfers.createRequest({ title: "Invoices" });
    const waited = await transfers.wait({
      transferId: "transfer-1",
      agentToken: "token-1",
      seconds: 2,
    });
    expect(waited).toMatchObject({ code: "not_found", status: 404 });
  });
});

describe("B7 — agent or person can cancel while it is open", () => {
  it("cancels while open and cancel-again stays cancelled", async () => {
    const { transfers } = service();
    await transfers.createRequest({ title: "Invoices" });
    const first = await transfers.cancel({
      transferId: "transfer-1",
      agentToken: "token-2",
    });
    const again = await transfers.cancel({
      transferId: "transfer-1",
      agentToken: "token-2",
    });
    expect(first).toMatchObject({ transferId: "transfer-1", status: "cancelled" });
    expect(again).toMatchObject({ status: "cancelled" });
    if (isTransferServiceError(first)) {
      throw new Error("expected cancel");
    }
    expect(first).not.toHaveProperty("manageUrl");
    expect(first).not.toHaveProperty("pollUrl");
  });

  it("lets the person cancel with the public token", async () => {
    const { transfers } = service();
    await transfers.createRequest({ title: "Invoices" });
    const cancelled = await transfers.cancel({
      transferId: "transfer-1",
      publicToken: "token-1",
    });
    expect(cancelled).toMatchObject({ status: "cancelled" });
    const status = await transfers.getForAgent({
      transferId: "transfer-1",
      agentToken: "token-2",
    });
    expect(status).toMatchObject({ status: "cancelled" });
  });

  it("refuses cancel when the request has already expired", async () => {
    const { transfers, advance } = waitingService();
    await transfers.createRequest({ title: "Invoices", expiresInSeconds: 60 });
    advance(61_000);
    const refused = await transfers.cancel({
      transferId: "transfer-1",
      agentToken: "token-2",
    });
    expect(refused).toMatchObject({ code: "frozen", status: 409 });
    const status = await transfers.getForAgent({
      transferId: "transfer-1",
      agentToken: "token-2",
    });
    expect(status).toMatchObject({ status: "expired" });
  });

  it("refuses cancel when the request is already complete", async () => {
    const { transfers, store } = service();
    await transfers.createRequest({ title: "Invoices" });
    const open = await store.getById("transfer-1");
    if (!open) {
      throw new Error("expected transfer");
    }
    await store.save({ ...open, status: "complete", completedAt: open.createdAt });
    const refused = await transfers.cancel({
      transferId: "transfer-1",
      agentToken: "token-2",
    });
    expect(refused).toMatchObject({ code: "frozen", status: 409 });
  });
});

describe("B2 / B6 / B7 / B9 — upload page copy", () => {
  it("does not show another request's title on an unknown or mismatched link", async () => {
    const { transfers } = service();
    await transfers.createRequest({ title: "Invoices" });
    const unknown = await transfers.getForPublic({ transferId: "missing", publicToken: "token-1" });
    const wrong = await transfers.getForPublic({ transferId: "transfer-1", publicToken: "other" });
    expect(humanScreenFor(unknown)).toBe("unknown");
    expect(humanScreenFor(wrong)).toBe("unknown");
    expect(uploadPageCopy("unknown").heading).toBe("This link is not valid");
  });

  it("uses expired and cancelled copy for those states", async () => {
    const { transfers, advance } = waitingService();
    await transfers.createRequest({ title: "Invoices", expiresInSeconds: 60 });
    advance(61_000);
    const expired = await transfers.getForPublic({
      transferId: "transfer-1",
      publicToken: "token-1",
    });
    expect(humanScreenFor(expired)).toBe("expired");
    expect(uploadPageCopy("expired").heading).toBe("This link has expired");

    const { transfers: open } = service();
    await open.createRequest({ title: "Invoices" });
    await open.cancel({ transferId: "transfer-1", publicToken: "token-1" });
    const cancelled = await open.getForPublic({
      transferId: "transfer-1",
      publicToken: "token-1",
    });
    expect(humanScreenFor(cancelled)).toBe("cancelled");
    expect(uploadPageCopy("cancelled").heading).toBe("This transfer was cancelled");
  });

  it("names the request on the manage markdown while it is still open", async () => {
    const { transfers } = service();
    await transfers.createRequest({ title: "Invoices" });
    const markdown = await transfers.markdownForManage({
      transferId: "transfer-1",
      agentToken: "token-2",
    });
    expect(typeof markdown).toBe("string");
    if (typeof markdown !== "string") {
      return;
    }
    expect(markdown).toContain("# Invoices");
    expect(markdown).toContain("No files yet.");
    expect(markdown).toContain("/s/transfer-1?t=token-1");
  });

  it("keeps the title on an open request and does not leak the agent secret", async () => {
    const { transfers } = service();
    await transfers.createRequest({ title: "Invoices", message: "Q3 pack" });
    const view = await transfers.getForPublic({
      transferId: "transfer-1",
      publicToken: "token-1",
    });
    expect(humanScreenFor(view)).toBe("open");
    expect(view).toMatchObject({ title: "Invoices", message: "Q3 pack" });
    expect(JSON.stringify(view)).not.toContain("token-2");
  });
});

describe("B10 — callback is marked attempted on a terminal cancel", () => {
  it("marks a callback URL as attempted without requiring a file list", async () => {
    const { transfers, store } = service();
    await transfers.createRequest({
      title: "Invoices",
      callbackUrl: "https://example.com/hook",
    });
    await transfers.cancel({ transferId: "transfer-1", agentToken: "token-2" });
    const saved = await store.getById("transfer-1");
    expect(saved?.callbackSent).toBe(true);
    expect(saved?.status).toBe("cancelled");
  });
});
