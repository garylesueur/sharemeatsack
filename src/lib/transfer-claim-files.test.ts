import { expect, it, vi } from "vitest";
import { createMemoryCleanroom } from "./cleanroom";
import { createMemoryObjectStore } from "./object-store";
import {
  createTransferFileClaimWorker,
  type TransferFileClaim,
  type TransferClaimFile,
} from "./transfer-claim-files";

const intentId = "opaque-native-intent";
const claimId = "6225b4ba-405e-49bc-8866-51bd8ecdd1e5";
const copyId = "6225b4ba-405e-49bc-8866-51bd8ecdd1e6";
const scanId = "6225b4ba-405e-49bc-8866-51bd8ecdd1e7";
const start = Date.parse("2026-10-11T22:00:00Z");
async function fixture(options: { hold?: boolean; unsafe?: boolean } = {}) {
  let time = start;
  const objects = createMemoryObjectStore(() => new Date(time));
  const scanner = createMemoryCleanroom({
    hold: options.hold,
    ...(options.unsafe
      ? { verdictFor: () => ({ verdict: "infected" as const, signature: "test" }) }
      : {}),
  });
  const file: TransferClaimFile = {
    fileId: "public-original",
    storageId: "private-storage",
    name: "note.txt",
    contentType: "text/plain",
    size: 4,
    sourceKey: "sharemeatsack/original/public-original/note.txt",
    copyState: "pending",
    scanStatus: "pending",
    receivedAt: new Date(start - 1000).toISOString(),
    retainedUntil: start + 90 * 86_400_000,
  };
  const identity = {
    intentId,
    sourceId: "original",
    accountId: "verified-account",
    attemptId: claimId,
    snapshotHash: "a".repeat(64),
  };
  let row: TransferFileClaim = {
    ...identity,
    state: "writing",
    stageId: `claim_${claimId}`,
    deadlineAt: start + 600_000,
    files: [file],
  };
  let copyWrites = 0;
  const write = objects.copyVersion!.bind(objects);
  objects.copyVersion = async (...args) => {
    copyWrites += 1;
    await write(...args);
  };
  await objects.put(file.sourceKey, new Uint8Array([1, 2, 3, 4]), "text/plain");
  const call = vi.fn(async (operation: string, args: Record<string, unknown>): Promise<unknown> => {
    expect(args.intentId).toBe(intentId);
    if (operation === "getClaimAttempt") return structuredClone(row);
    if (operation === "abortClaimFiles") {
      row = { ...identity, state: "aborted", cleanupPending: true, transfer: null };
      return structuredClone(row);
    }
    if (row.state !== "writing") return structuredClone(row);
    const target = row.files[0];
    if (operation === "beginClaimCopy") {
      const created = target.copyState === "pending";
      if (created)
        Object.assign(target, {
          copyState: "copying",
          copyAttemptId: args.copyAttemptId,
          copyDeadlineAt: time + 120_000,
          objectKey: `sharemeatsack/owned/original/private-storage/sealed/${args.copyAttemptId}`,
        });
      return structuredClone({ created, attempt: row, file: target });
    }
    if (operation === "finishClaimCopy")
      Object.assign(target, { copyState: "copied", destinationVersion: args.destinationVersion });
    if (operation === "beginClaimScan") {
      const created = !target.scanAttemptId;
      if (created)
        Object.assign(target, { scanAttemptId: args.scanAttemptId, scanStatus: "scanning" });
      return structuredClone({ created, attempt: row, file: target });
    }
    if (operation === "registerClaimScan") Object.assign(target, { scanHandle: args.scanHandle });
    if (operation === "claimScanResult") {
      expect(args.destinationVersion).toBe(target.destinationVersion);
      expect(args.scanAttemptId).toBe(target.scanAttemptId);
      expect(args.scanHandle).toBe(target.scanHandle);
      target.scanStatus = args.status as TransferClaimFile["scanStatus"];
      if (["infected", "failed"].includes(target.scanStatus))
        row = { ...identity, state: "aborted", cleanupPending: true, transfer: null };
    }
    if (operation === "commitClaimFiles") {
      expect(target.scanStatus).toBe("clean");
      row = { ...identity, state: "committed", cleanupPending: false, transfer: "{}" };
    }
    return structuredClone(row);
  });
  const worker = createTransferFileClaimWorker({
    metadata: { call },
    objects,
    scanner,
    baseUrl: "https://sharemeatsack.test",
    callbackUrl: "https://sharemeatsack.test/api/v1/claims/scan-result",
    now: () => time,
    randomUUID: () =>
      row.state === "writing" && row.files[0].copyState === "pending" ? copyId : scanId,
  });
  return {
    worker,
    objects,
    scanner,
    call,
    file,
    row: () => row,
    copyWrites: () => copyWrites,
    setTime: (value: number) => {
      time = value;
    },
  };
}

it("publishes an independently frozen file only after a fresh scan and original retention remains unchanged", async () => {
  const f = await fixture();
  await f.worker.process(intentId); // COPY election and verified destination.
  await f.objects.put(f.file.sourceKey, new Uint8Array([9, 9, 9, 9]), "text/plain");
  await f.worker.process(intentId); // Fresh sealed-object scan.
  const submitted = [...f.scanner.submitted.values()][0];
  expect(new URL(submitted.url).pathname).toContain(
    `/owned/original/private-storage/sealed/${copyId}`,
  );
  expect(submitted.submissionKey).toContain(scanId);
  expect(f.row().state).toBe("writing");
  await f.worker.process(intentId);
  expect(f.row().state).toBe("committed");
  expect(f.copyWrites()).toBe(1);
  expect((await f.objects.get(f.file.objectKey!))?.body).toEqual(new Uint8Array([1, 2, 3, 4]));
  expect(f.file.receivedAt).toBe(new Date(start - 1000).toISOString());
  expect(f.file.retainedUntil).toBe(start + 90 * 86_400_000);
});

it("reconciles a lost copy acknowledgement without writing the destination twice", async () => {
  const f = await fixture();
  const copy = f.objects.copyVersion!;
  f.objects.copyVersion = async (...args) => {
    await copy(...args);
    throw new Error("lost COPY reply");
  };
  await expect(f.worker.process(intentId)).rejects.toThrow("lost COPY reply");
  await f.worker.process(intentId);
  expect(f.copyWrites()).toBe(1);
  expect(f.file.copyState).toBe("copied");
});

it("keeps a pending scan hidden and safely polls its recorded handle on a later job", async () => {
  const f = await fixture({ hold: true });
  await f.worker.process(intentId);
  await f.worker.process(intentId);
  await f.worker.process(intentId);
  expect(f.row().state).toBe("writing");
  expect(f.scanner.submitted.size).toBe(1);
  f.scanner.resolve(f.file.scanHandle!, { verdict: "clean" });
  await f.worker.process(intentId);
  await f.worker.process(intentId);
  expect(f.row().state).toBe("committed");
});

it("never publishes an unsafe scan or an object changed after scan submission", async () => {
  const infected = await fixture({ unsafe: true });
  await infected.worker.process(intentId);
  await infected.worker.process(intentId);
  expect(infected.row().state).toBe("aborted");
  const changed = await fixture({ hold: true });
  await changed.worker.process(intentId);
  await changed.worker.process(intentId);
  await changed.objects.put(changed.file.objectKey!, new Uint8Array([4, 3, 2, 1]), "text/plain");
  changed.scanner.resolve(changed.file.scanHandle!, { verdict: "clean" });
  await changed.worker.process(intentId);
  expect(changed.row().state).toBe("aborted");
});

it("does not copy bytes beyond reservation, expired work or missing native authority", async () => {
  const oversized = await fixture();
  await oversized.objects.put(oversized.file.sourceKey, new Uint8Array(5), "text/plain");
  await oversized.worker.process(intentId);
  expect(oversized.row().state).toBe("aborted");
  expect(oversized.copyWrites()).toBe(0);
  const expired = await fixture();
  expired.setTime(start + 600_000);
  await expired.worker.process(intentId);
  expect(expired.row().state).toBe("aborted");
  const unknown = await fixture();
  unknown.call.mockResolvedValueOnce(null);
  expect(await unknown.worker.process(intentId)).toBe(false);
  expect(unknown.copyWrites()).toBe(0);
});

it("cannot copy arbitrary keys supplied by a malformed native response", async () => {
  const f = await fixture();
  const row = structuredClone(f.row());
  if (row.state !== "writing") throw new Error("fixture");
  row.files[0].sourceKey = "sharemeatsack/library/another-account/sealed/file";
  f.call.mockResolvedValueOnce(row);
  await expect(f.worker.process(intentId)).rejects.toThrow("storage_unavailable");
  expect(f.copyWrites()).toBe(0);
});
