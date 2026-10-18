import { describe, expect, it, vi } from "vitest";
import { accountClaimRequest } from "./account-claim-request";
const input = {
  sourceId: "synthetic-source",
  proof: "synthetic-private-proof",
  attemptId: "6225b4ba-405e-49bc-8866-51bd8ecdd1e5",
};
function request(value: unknown = input) {
  return new Request("http://localhost/api/v1/account/claims", {
    method: "POST",
    body: JSON.stringify(value),
  });
}
function ports() {
  return {
    verify: vi.fn().mockResolvedValue({ outcome: "accepted", account: "verified-account" }),
    claim: vi.fn().mockResolvedValue({ status: "claimed", id: "owned-transfer" }),
  };
}
describe("bounded Share claim account POST", () => {
  it("uses only verified current product authority and does not return private proof", async () => {
    const deps = ports();
    const response = await accountClaimRequest(request(), deps);
    expect(deps.claim).toHaveBeenCalledWith(
      { sourceId: input.sourceId, agentToken: input.proof, attemptId: input.attemptId },
      { accountId: "verified-account" },
    );
    expect(await response.json()).toEqual({ status: "claimed", id: "owned-transfer" });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("does no proof or source work for a refused bearer", async () => {
    const deps = ports();
    deps.verify.mockResolvedValue({ outcome: "refused" });
    expect((await accountClaimRequest(request(), deps)).status).toBe(401);
    expect(deps.claim).not.toHaveBeenCalled();
  });
  it("refuses caller account, public links, invalid attempts and oversized proof", async () => {
    const deps = ports();
    for (const value of [
      { ...input, accountId: "foreign" },
      { ...input, url: "https://synthetic.example/s/public" },
      { ...input, attemptId: "unbound" },
      { ...input, proof: "x".repeat(9000) },
    ]) {
      expect((await accountClaimRequest(request(value), deps)).status).toBeGreaterThanOrEqual(400);
    }
    expect(deps.claim).not.toHaveBeenCalled();
  });
  it("strips error messages and refuses malformed proof-bearing success output", async () => {
    const deps = ports();
    deps.claim.mockResolvedValueOnce({
      code: "claim_files_unsupported",
      status: 409,
      message: input.proof,
    });
    const refused = await accountClaimRequest(request(), deps);
    expect(refused.status).toBe(409);
    expect(await refused.text()).not.toContain(input.proof);
    deps.claim.mockResolvedValueOnce({
      status: "claimed",
      id: "owned-transfer",
      agentToken: input.proof,
    });
    expect((await accountClaimRequest(request(), deps)).status).toBe(503);
    deps.claim.mockRejectedValueOnce(new Error(input.proof));
    expect(await (await accountClaimRequest(request(), deps)).text()).not.toContain(input.proof);
  });
});
