import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { claimResolutionRequest, type SourceClaimState } from "./claim-resolution";
const binding = {
  accountId: "account",
  sourceId: "source",
  attemptId: "6225b4ba-405e-49bc-8866-51bd8ecdd1e5",
  proofHash: "a".repeat(64),
  intentId: "intent",
};
const receipt = {
  ...binding,
  product: "sharemeatsack" as const,
  state: "aborted" as const,
  createdAt: 1000,
  deadlineAt: 901000,
  sourceResolved: false,
};
const secret = "synthetic-callback-secret";
function request(
  outcome = "aborted",
  overrides: Record<string, unknown> = {},
  signedSecret = secret,
) {
  const body = JSON.stringify({ ...binding, product: "sharemeatsack", outcome, ...overrides });
  return new Request("http://localhost/api/v1/claims/resolve", {
    method: "POST",
    body,
    headers: {
      "claim-resolution-signature": `t=1,v1=${createHmac("sha256", signedSecret).update(`1.claim-resolution.${body}`).digest("hex")}`,
    },
  });
}
function setup(state: SourceClaimState = "pending") {
  const get = vi.fn().mockResolvedValue(receipt);
  const inspectClaim = vi.fn().mockResolvedValue(state);
  const resolveClaim = vi.fn().mockResolvedValue(true);
  return {
    get,
    inspectClaim,
    resolveClaim,
    deps: { secret, now: () => 1000, intents: { get }, source: { inspectClaim, resolveClaim } },
  };
}
describe("Share definitive signed source claim resolution", () => {
  it("re-reads a terminal receipt then installs abort barriers even if a source fence was never installed", async () => {
    const { deps, get, resolveClaim } = setup("none");
    const response = await claimResolutionRequest(request(), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      ...binding,
      product: "sharemeatsack",
      outcome: "aborted",
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(get).toHaveBeenCalledWith(binding);
    expect(resolveClaim).toHaveBeenCalledWith("source", "account", binding.attemptId, "aborted");
  });
  it("does not unlock from a signature alone, null read, pending receipt or wrong source fence", async () => {
    await Promise.all(
      [
        null,
        { ...receipt, state: "prepared" },
        { ...receipt, state: "started" },
        { ...receipt, state: "committed" },
        { ...receipt, sourceResolved: true },
      ].map(async (value) => {
        const { deps, get, resolveClaim } = setup();
        get.mockResolvedValue(value);
        expect((await claimResolutionRequest(request(), deps)).status).toBe(409);
        expect(resolveClaim).not.toHaveBeenCalled();
      }),
    );
    const { deps, resolveClaim } = setup("foreign");
    expect((await claimResolutionRequest(request(), deps)).status).toBe(409);
    expect(resolveClaim).not.toHaveBeenCalled();
  });
  it("retires only a matched committed source and refuses contradictory aborts", async () => {
    const { deps, get, resolveClaim } = setup("committed");
    get.mockResolvedValue({ ...receipt, state: "committed" });
    expect((await claimResolutionRequest(request("committed"), deps)).status).toBe(200);
    expect(resolveClaim).toHaveBeenCalledWith("source", "account", binding.attemptId, "committed");
    resolveClaim.mockClear();
    get.mockResolvedValue(receipt);
    expect((await claimResolutionRequest(request(), deps)).status).toBe(409);
    expect(resolveClaim).not.toHaveBeenCalled();
  });
  it("refuses tampering and wrong products before touching authority or the source", async () => {
    const { deps, get, resolveClaim } = setup();
    expect(
      (await claimResolutionRequest(request("aborted", {}, "foreign-secret"), deps)).status,
    ).toBe(401);
    expect(
      (await claimResolutionRequest(request("aborted", { product: "askmeatsack" }), deps)).status,
    ).toBe(400);
    expect(
      (await claimResolutionRequest(request("aborted", { proof: "raw-private-proof" }), deps))
        .status,
    ).toBe(400);
    expect(get).not.toHaveBeenCalled();
    expect(resolveClaim).not.toHaveBeenCalled();
  });
  it("keeps recovery pending if receipt reads or source persistence fail", async () => {
    const { deps, get, resolveClaim } = setup();
    get.mockRejectedValueOnce(new Error("offline"));
    expect((await claimResolutionRequest(request(), deps)).status).toBe(503);
    expect(resolveClaim).not.toHaveBeenCalled();
    resolveClaim.mockResolvedValueOnce(false);
    expect((await claimResolutionRequest(request(), deps)).status).toBe(409);
    resolveClaim.mockRejectedValueOnce(new Error("Redis unavailable"));
    expect((await claimResolutionRequest(request(), deps)).status).toBe(503);
  });
});
