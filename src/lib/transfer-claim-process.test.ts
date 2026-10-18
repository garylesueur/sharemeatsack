import { createHmac } from "node:crypto";
import { expect, it, vi } from "vitest";
import { transferClaimProcessRequest } from "./transfer-claim-process";

const now = Date.parse("2026-10-11T22:00:00Z");
const secret = "synthetic-claim-process-secret";
function request(
  body: unknown,
  options: { signed?: boolean; time?: number; domain?: string } = {},
) {
  const payload = JSON.stringify(body);
  const seconds = Math.floor((options.time ?? now) / 1000);
  const signature = createHmac("sha256", secret)
    .update(`${seconds}.${options.domain ?? "sharemeatsack-claim-process"}.${payload}`)
    .digest("hex");
  return new Request("https://sharemeatsack.test/api/v1/claims/process", {
    method: "POST",
    body: payload,
    headers:
      options.signed === false
        ? {}
        : {
            "transfer-claim-process-signature": `t=${seconds},v1=${signature}`,
          },
  });
}

it("does not grant work to unsigned, expired or cross-purpose callback signatures", async () => {
  const process = vi.fn();
  for (const options of [
    { signed: false },
    { time: now - 300_001 },
    { domain: "transfer-cleanup" },
  ]) {
    const response = await transferClaimProcessRequest(
      request({ intentId: "claim-selector" }, options),
      {
        secret,
        process,
        now: () => now,
      },
    );
    expect(response.status).toBe(401);
  }
  expect(process).not.toHaveBeenCalled();
});

it("rejects caller-supplied account, object key or proof even in a correctly signed callback", async () => {
  const process = vi.fn();
  const response = await transferClaimProcessRequest(
    request({ intentId: "claim-selector", accountId: "foreign" }),
    {
      secret,
      process,
      now: () => now,
    },
  );
  expect(response.status).toBe(400);
  expect(process).not.toHaveBeenCalled();
});

it("passes only the opaque selector to a worker and permits a safe duplicate retry", async () => {
  const process = vi.fn().mockResolvedValue(true);
  for (let i = 0; i < 2; i++) {
    const response = await transferClaimProcessRequest(request({ intentId: "claim-selector" }), {
      secret,
      process,
      now: () => now,
    });
    expect(await response.json()).toEqual({ ok: true });
  }
  expect(process.mock.calls).toEqual([["claim-selector"], ["claim-selector"]]);
});

it("does not acknowledge failed or uncertain work and never reflects provider data", async () => {
  const process = vi
    .fn()
    .mockResolvedValueOnce(false)
    .mockRejectedValueOnce(new Error("private provider URL"));
  const first = await transferClaimProcessRequest(request({ intentId: "claim-selector" }), {
    secret,
    process,
    now: () => now,
  });
  expect(first.status).toBe(409);
  const second = await transferClaimProcessRequest(request({ intentId: "claim-selector" }), {
    secret,
    process,
    now: () => now,
  });
  expect(second.status).toBe(503);
  expect(await second.text()).not.toContain("private provider URL");
});
