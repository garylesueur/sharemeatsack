import { expect, it, vi } from "vitest";
import { createMemoryCleanroom } from "./cleanroom";
import { transferClaimScanRequest } from "./transfer-claim-scan";
const request = (body: unknown) =>
  new Request("https://sharemeatsack.test/api/v1/claims/scan-result", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "cleanroom-signature": "synthetic" },
  });

it("does not look up or process unsigned scanner callbacks", async () => {
  const scanner = createMemoryCleanroom();
  scanner.verifyCallback = () => false;
  const call = vi.fn();
  const process = vi.fn();
  const response = await transferClaimScanRequest(
    request({ handle: "untrusted", verdict: { verdict: "clean" } }),
    {
      scanner,
      metadata: { call },
      process,
    },
  );
  expect(response.status).toBe(404);
  expect(call).not.toHaveBeenCalled();
  expect(process).not.toHaveBeenCalled();
});

it("uses only the authoritative native handle pointer and never trusts a callback-supplied verdict or account", async () => {
  const call = vi.fn().mockResolvedValue({ intentId: "actual-intent", fileId: "actual-file" });
  const process = vi.fn().mockResolvedValue(true);
  const response = await transferClaimScanRequest(
    request({
      handle: "scanner-handle",
      accountId: "foreign",
      intentId: "forged",
      verdict: { verdict: "clean" },
    }),
    {
      scanner: createMemoryCleanroom(),
      metadata: { call },
      process,
    },
  );
  expect(await response.json()).toEqual({ ok: true });
  expect(call).toHaveBeenCalledWith("lookupClaimScan", { handle: "scanner-handle" });
  expect(process.mock.calls).toEqual([["actual-intent"]]);
});

it("refuses unknown and malformed pointer results without granting source or ordinary scan access", async () => {
  const call = vi
    .fn()
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ intentId: "candidate", fileId: "file", objectKey: "other-account" });
  const process = vi.fn();
  expect(
    (
      await transferClaimScanRequest(request({ handle: "unknown" }), {
        scanner: createMemoryCleanroom(),
        metadata: { call },
        process,
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await transferClaimScanRequest(request({ handle: "unknown" }), {
        scanner: createMemoryCleanroom(),
        metadata: { call },
        process,
      })
    ).status,
  ).toBe(503);
  expect(process).not.toHaveBeenCalled();
});
