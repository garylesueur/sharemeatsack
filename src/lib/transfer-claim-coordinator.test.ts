/* eslint-disable no-await-in-loop -- Sequential source snapshots and terminal outcomes. */
import { createHash, createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createTransferClaimCoordinator } from "./transfer-claim-coordinator";
import { createTransferClaimMetadata } from "./transfer-claim-metadata";
import { createTransferFileClaimMetadata } from "./transfer-claim-files";
import { OwnedTransferError } from "./owned-transfer-metadata";
import { createOwnedTransferStore } from "./owned-transfer-store";
import { createMemoryTransferStore, type Transfer } from "./transfer-store";
import type { ClaimBinding, ClaimIntent } from "./claim-intent-client";
import { claimResolutionRequest } from "./claim-resolution";
const now = Date.parse("2026-10-11T12:00:00Z");
const attempt = "6225b4ba-405e-49bc-8866-51bd8ecdd1e5";
const originalAttempt = "6225b4ba-405e-49bc-8866-51bd8ecdd1e6";
const value: Transfer = {
  id: "legacy",
  kind: "request",
  status: "open",
  title: "Original",
  createdAt: "2026-10-10T12:00:00Z",
  expiresAt: "2026-10-12T12:00:00Z",
  publicToken: "public",
  agentToken: "private",
  files: [],
  callbackUrl: "https://original.example/callback",
  callbackSent: true,
};
const input = { sourceId: value.id, agentToken: value.agentToken, attemptId: attempt };
function fixture() {
  const legacy = createMemoryTransferStore();
  let native: Transfer | "retired" | null = null;
  let intent: ClaimIntent | null = null;
  let nativeReceipt: unknown = null;
  let lostReply = false;
  const metadataCall = vi.fn(
    async (operation: string, args: Record<string, unknown>): Promise<unknown> => {
      if (operation === "getById")
        return native === "retired" ? { retired: true } : native ? JSON.stringify(native) : null;
      if (operation === "getClaim") return nativeReceipt;
      if (operation === "claimTransfer") {
        if (!intent || intent.state !== "prepared" || intent.attemptId !== args.attemptId)
          throw new Error("conflict");
        expect(args.snapshotHash).toBe(
          createHash("sha256").update(String(args.transfer)).digest("hex"),
        );
        expect(args.proofHash).toBe(createHash("sha256").update(value.agentToken).digest("hex"));
        native = { ...JSON.parse(String(args.transfer)), ownerAccountId: args.accountId };
        intent = { ...intent, state: "committed" };
        nativeReceipt = {
          state: "committed",
          sourceId: args.sourceId,
          id: args.sourceId,
          attemptId: args.attemptId,
          snapshotHash: args.snapshotHash,
          transfer: JSON.stringify(native),
        };
        if (lostReply) throw new Error("lost response");
        return nativeReceipt;
      }
      throw new Error("Unexpected operation");
    },
  );
  const originalBegin = legacy.beginClaim!.bind(legacy);
  const begin = vi.spyOn(legacy, "beginClaim");
  const store = createOwnedTransferStore({ legacy, metadata: { call: metadataCall } });
  const intents = {
    prepare: vi.fn(
      async (identity: Omit<ClaimBinding, "intentId">): Promise<ClaimIntent | null> => {
        intent = {
          ...identity,
          intentId: "intent",
          attemptId: originalAttempt,
          product: "sharemeatsack",
          state: "prepared",
          createdAt: now,
          deadlineAt: now + 900_000,
          sourceResolved: false,
        };
        return intent;
      },
    ),
    get: vi.fn(async (): Promise<ClaimIntent | null> => intent),
    cancel: vi.fn(async (): Promise<ClaimIntent | null> => {
      if (intent?.state === "prepared") intent = { ...intent, state: "aborted" };
      return intent;
    }),
  };
  const metadata = createTransferClaimMetadata({ call: metadataCall });
  const coordinator = createTransferClaimCoordinator({ store, metadata, intents, now: () => now });
  return {
    legacy,
    store,
    metadata,
    coordinator,
    intents,
    metadataCall,
    begin,
    originalBegin,
    setNative(next: Transfer | "retired" | null) {
      native = next;
    },
    getIntent: () => intent,
    lostReply() {
      lostReply = true;
    },
    nullNativeReceipt() {
      nativeReceipt = null;
    },
    startIntent() {
      if (!intent) throw new Error("No prepared fixture intent");
      intent = { ...intent, state: "started" };
    },
    withFiles(fileClaims: ReturnType<typeof createTransferFileClaimMetadata>) {
      return createTransferClaimCoordinator({
        store,
        metadata,
        intents,
        fileClaims,
        now: () => now,
      });
    },
  };
}
const attachment = {
  id: "original-file",
  filename: "original.txt",
  contentType: "text/plain",
  size: 4,
  key: "sharemeatsack/legacy/original-file/original.txt",
  state: "accepted" as const,
  receivedAt: "2026-10-10T12:01:00Z",
  scanStatus: "clean",
};

it("starts hidden attachment work under the exact frozen identity while keeping the anonymous source fenced", async () => {
  const f = fixture();
  const original = { ...value, files: [attachment] };
  await f.legacy.save(original);
  const call = vi.fn(async (operation: string, args: Record<string, unknown>) => {
    expect(operation).toBe("beginClaimFiles");
    expect(args.transfer).toBe(JSON.stringify(original));
    expect(args.snapshotHash).toBe(
      createHash("sha256").update(String(args.transfer)).digest("hex"),
    );
    expect(args.attemptId).toBe(originalAttempt);
    f.startIntent();
    return {
      state: "writing",
      intentId: "intent",
      sourceId: value.id,
      accountId: "account",
      attemptId: originalAttempt,
      snapshotHash: args.snapshotHash,
      stageId: "private-stage",
      deadlineAt: now + 600000,
      files: [
        {
          fileId: attachment.id,
          storageId: "private-storage",
          name: attachment.filename,
          contentType: attachment.contentType,
          size: attachment.size,
          sourceKey: attachment.key,
          copyState: "pending",
          scanStatus: "pending",
          receivedAt: attachment.receivedAt,
          retainedUntil: Date.parse(attachment.receivedAt) + 90 * 86400000,
        },
      ],
    };
  });
  const coordinator = f.withFiles(createTransferFileClaimMetadata({ call }));
  expect(await coordinator.claim(input, { accountId: "account" })).toMatchObject({
    code: "claim_pending",
  });
  expect(await f.legacy.inspectClaim!(value.id, "account", originalAttempt)).toBe("pending");
  expect(await f.store.getById(value.id)).toEqual(original);
  expect(f.intents.cancel).not.toHaveBeenCalled();
  expect(f.metadataCall.mock.calls.some(([operation]) => operation === "claimTransfer")).toBe(
    false,
  );
});

it("refuses unknown receipt dates without preparing intent or changing the anonymous file", async () => {
  const f = fixture();
  const { receivedAt: _receivedAt, ...unknown } = attachment;
  const original = { ...value, files: [unknown] };
  await f.legacy.save(original);
  expect(await f.coordinator.claim(input, { accountId: "account" })).toMatchObject({
    code: "claim_receipt_unknown",
  });
  expect(f.intents.prepare).not.toHaveBeenCalled();
  expect(await f.legacy.getById(value.id)).toEqual(original);
});

it("a refused file reservation definitively cancels unstarted intent before restoring the original source", async () => {
  const f = fixture();
  const original = { ...value, files: [attachment] };
  await f.legacy.save(original);
  const coordinator = f.withFiles(
    createTransferFileClaimMetadata({
      call: vi.fn().mockRejectedValue(new OwnedTransferError("storage_allowance", 413)),
    }),
  );
  expect(await coordinator.claim(input, { accountId: "account" })).toMatchObject({
    code: "storage_capacity",
  });
  expect(f.getIntent()?.state).toBe("aborted");
  expect(await f.legacy.inspectClaim!(value.id, "account", originalAttempt)).toBe("none");
  expect(await f.legacy.getById(value.id)).toEqual(original);
});
it("maps native provenance refusal honestly and restores only after definitive cancellation", async () => {
  const f = fixture();
  const original = { ...value, files: [attachment] };
  await f.legacy.save(original);
  const coordinator = f.withFiles(
    createTransferFileClaimMetadata({
      call: vi.fn().mockRejectedValue(new OwnedTransferError("claim_provenance_unknown", 409)),
    }),
  );
  expect(await coordinator.claim(input, { accountId: "account" })).toMatchObject({
    code: "claim_receipt_unknown",
  });
  expect(f.getIntent()?.state).toBe("aborted");
  expect(await f.legacy.inspectClaim!(value.id, "account", originalAttempt)).toBe("none");
  expect(await f.legacy.getById(value.id)).toEqual(original);
});
describe("Share fileless claim coordinator", () => {
  it("durably prepares before source fencing, uses original attempt UUID and retains exact native states/expiry", async () => {
    for (const state of ["open", "complete", "cancelled", "expired", "ready"] as const) {
      const f = fixture();
      const source = {
        ...value,
        status: state,
        ...(state === "ready" ? { kind: "send" as const } : {}),
        ...(state === "complete" ? { completedAt: "2026-10-11T11:00:00Z" } : {}),
        ...(state === "cancelled" ? { cancelledAt: "2026-10-11T11:00:00Z" } : {}),
        ...(state === "expired" ? { expiresAt: "2026-10-11T11:00:00Z" } : {}),
      };
      await f.legacy.save(source);
      const actual = f.originalBegin;
      f.begin.mockImplementation(async (...args) => {
        expect(f.getIntent()?.state).toBe("prepared");
        return actual(...args);
      });
      expect(await f.coordinator.claim(input, { accountId: "account" })).toEqual({
        status: "claimed",
        id: value.id,
      });
      expect(f.begin).toHaveBeenCalledWith(value.id, "account", originalAttempt, value.agentToken);
      const importArgs = f.metadataCall.mock.calls.find(
        ([operation]) => operation === "claimTransfer",
      )![1];
      expect(importArgs.transfer).toBe(JSON.stringify(source));
      expect(await f.store.getById(value.id)).toEqual({ ...source, ownerAccountId: "account" });
      expect(await f.legacy.inspectClaim!(value.id, "account", originalAttempt)).toBe("committed");
      expect(f.getIntent()?.sourceResolved).toBe(false);
    }
  });
  it("returns the same generic refusal for public proof, missing source, foreign owner and legacy ownership labels without preparation", async () => {
    const f = fixture();
    await f.legacy.save(value);
    expect(
      await f.coordinator.claim(
        { ...input, agentToken: value.publicToken },
        { accountId: "account" },
      ),
    ).toMatchObject({ code: "not_found" });
    expect(
      await f.coordinator.claim({ ...input, sourceId: "missing" }, { accountId: "account" }),
    ).toMatchObject({ code: "not_found" });
    await f.legacy.delete(value.id);
    await f.legacy.save({ ...value, ownerAccountId: "account" });
    expect(await f.coordinator.claim(input, { accountId: "account" })).toMatchObject({
      code: "not_found",
    });
    f.setNative({ ...value, ownerAccountId: "other" });
    expect(await f.coordinator.claim(input, { accountId: "account" })).toMatchObject({
      code: "not_found",
    });
    expect(f.intents.prepare).not.toHaveBeenCalled();
    expect(f.begin).not.toHaveBeenCalled();
  });
  it("accepts only authoritative same-account native ownership with fresh private proof and refuses retirement", async () => {
    const f = fixture();
    f.setNative({ ...value, ownerAccountId: "account" });
    expect(await f.coordinator.claim(input, { accountId: "account" })).toEqual({
      status: "claimed",
      id: value.id,
    });
    expect(
      await f.coordinator.claim({ ...input, agentToken: "wrong" }, { accountId: "account" }),
    ).toMatchObject({ code: "not_found" });
    f.setNative("retired");
    expect(await f.coordinator.claim(input, { accountId: "account" })).toMatchObject({
      code: "not_found",
    });
    expect(f.intents.prepare).not.toHaveBeenCalled();
    expect(f.begin).not.toHaveBeenCalled();
    expect(
      f.metadataCall.mock.calls.filter(([operation]) => operation === "claimTransfer"),
    ).toEqual([]);
  });
  it("explicitly refuses every descriptor before preparation and aborts a changed frozen snapshot without dropping it", async () => {
    for (const files of [
      [{ id: "pending", state: "pending" }],
      [{ id: "accepted", state: "accepted", receivedAt: "2026-10-01T00:00:00Z" }],
      null,
      {},
    ]) {
      const f = fixture();
      await f.legacy.save({ ...value, files } as Transfer);
      expect(await f.coordinator.claim(input, { accountId: "account" })).toMatchObject({
        code: "claim_files_unsupported",
      });
      expect(f.intents.prepare).not.toHaveBeenCalled();
      expect(f.begin).not.toHaveBeenCalled();
    }
    const f = fixture();
    await f.legacy.save(value);
    const actual = f.originalBegin;
    f.begin.mockImplementation(async (...args) => {
      await f.legacy.save({
        ...value,
        files: [
          { id: "late", filename: "late", contentType: "text/plain", size: 1, state: "pending" },
        ],
      });
      return actual(...args);
    });
    expect(await f.coordinator.claim(input, { accountId: "account" })).toMatchObject({
      code: "claim_files_unsupported",
    });
    expect(f.getIntent()?.state).toBe("aborted");
    expect((await f.legacy.getById(value.id))?.files).toHaveLength(1);
    expect(
      await f.legacy.beginClaim!(value.id, "account", originalAttempt, value.agentToken),
    ).toBeNull();
    expect(
      f.metadataCall.mock.calls.filter(([operation]) => operation === "claimTransfer"),
    ).toEqual([]);
  });
  it("reconciles a lost commit reply from native receipt and retries through authoritative owned overlay without another import", async () => {
    const f = fixture();
    await f.legacy.save(value);
    f.lostReply();
    expect(await f.coordinator.claim(input, { accountId: "account" })).toEqual({
      status: "claimed",
      id: value.id,
    });
    expect(
      await f.coordinator.claim({ ...input, attemptId: originalAttempt }, { accountId: "account" }),
    ).toEqual({ status: "claimed", id: value.id });
    expect(
      f.metadataCall.mock.calls.filter(([operation]) => operation === "claimTransfer"),
    ).toHaveLength(1);
    expect(
      f.metadataCall.mock.calls.filter(([operation]) => operation === "getClaim"),
    ).toHaveLength(1);
    expect(await f.legacy.inspectClaim!(value.id, "account", originalAttempt)).toBe("committed");
  });
  it("never unlocks from null/outage intent or native receipt, and leaves uncertain started work pending", async () => {
    for (const failure of [
      "null-intent",
      "outage-intent",
      "null-native",
      "outage-native",
      "started",
    ] as const) {
      const f = fixture();
      await f.legacy.save(value);
      if (failure === "null-intent") f.intents.get.mockResolvedValue(null);
      if (failure === "outage-intent") f.intents.get.mockRejectedValue(new Error("offline"));
      if (failure === "null-native" || failure === "outage-native") {
        f.lostReply();
        const call = f.metadataCall.getMockImplementation()!;
        f.metadataCall.mockImplementation(async (operation, args) =>
          operation === "getClaim"
            ? failure === "null-native"
              ? null
              : Promise.reject(new Error("offline"))
            : call(operation, args),
        );
      }
      if (failure === "started") {
        f.metadataCall.mockImplementation(async (operation) => {
          if (operation === "getById") return null;
          throw new Error("uncertain");
        });
        f.intents.get.mockImplementation(async () => ({ ...f.getIntent()!, state: "started" }));
        f.intents.cancel.mockImplementation(async () => ({ ...f.getIntent()!, state: "started" }));
      }
      const result = await f.coordinator.claim(input, { accountId: "account" });
      expect(result).toMatchObject({
        code: failure === "started" ? "claim_pending" : "storage_unavailable",
      });
      expect(await f.legacy.inspectClaim!(value.id, "account", originalAttempt)).toBe("pending");
    }
  });
  it("installs permanent abort barriers when a prepared attempt is cancelled before its delayed source begin", async () => {
    const f = fixture();
    await f.legacy.save(value);
    const prepare = f.intents.prepare.getMockImplementation()!;
    f.intents.prepare.mockImplementation(async (identity) => ({
      ...(await prepare(identity))!,
      state: "aborted",
    }));
    f.intents.get.mockImplementation(async () => ({ ...f.getIntent()!, state: "aborted" }));
    expect(await f.coordinator.claim(input, { accountId: "account" })).toMatchObject({
      code: "not_found",
    });
    expect(f.begin).not.toHaveBeenCalled();
    expect(
      await f.legacy.beginClaim!(value.id, "account", originalAttempt, value.agentToken),
    ).toBeNull();
    expect(await f.legacy.getById(value.id)).toEqual(value);
  });
  it("lets signed recovery resolve a committed source after an owner is retired, while outage never acknowledges it", async () => {
    const f = fixture();
    await f.legacy.save(value);
    f.intents.get.mockRejectedValueOnce(new Error("lost status"));
    expect(await f.coordinator.claim(input, { accountId: "account" })).toMatchObject({
      code: "storage_unavailable",
    });
    f.setNative("retired");
    const intent = f.getIntent()!;
    const {
      state: _state,
      createdAt: _created,
      deadlineAt: _deadline,
      sourceResolved: _resolved,
      ...binding
    } = intent;
    const secret = "synthetic-recovery-secret";
    function callback() {
      const body = JSON.stringify({ ...binding, outcome: "committed" });
      return new Request("http://localhost/api/v1/claims/resolve", {
        method: "POST",
        body,
        headers: {
          "claim-resolution-signature": `t=${now / 1000},v1=${createHmac("sha256", secret)
            .update(`${now / 1000}.claim-resolution.${body}`)
            .digest("hex")}`,
        },
      });
    }
    const deps = {
      secret,
      now: () => now,
      intents: f.intents,
      source: { inspectClaim: f.store.inspectClaim!, resolveClaim: f.store.resolveClaim! },
    };
    f.intents.get.mockRejectedValueOnce(new Error("offline"));
    expect((await claimResolutionRequest(callback(), deps)).status).toBe(503);
    expect(await f.legacy.inspectClaim!(value.id, "account", originalAttempt)).toBe("pending");
    const reply = await claimResolutionRequest(callback(), deps);
    expect(reply.status).toBe(200);
    expect(await reply.json()).toMatchObject({ ok: true, outcome: "committed" });
    expect(await f.legacy.inspectClaim!(value.id, "account", originalAttempt)).toBe("committed");
    expect(await f.legacy.getById(value.id)).toBeNull();
    expect(f.getIntent()?.sourceResolved).toBe(false);
  });
});
