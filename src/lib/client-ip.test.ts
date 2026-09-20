import { describe, expect, it } from "vitest";
import { SHARED_BUCKET, clientIpFromRequest } from "./client-ip";

function requestWith(headers: Record<string, string>): Request {
  return new Request("https://sharemeatsack.com/api/v1/transfers", { headers });
}

describe("create rate-limit address", () => {
  it("uses the address the platform observed", () => {
    expect(clientIpFromRequest(requestWith({ "x-vercel-forwarded-for": "203.0.113.7" }))).toBe(
      "203.0.113.7",
    );
  });

  it("ignores a forged x-forwarded-for", () => {
    expect(clientIpFromRequest(requestWith({ "x-forwarded-for": "1.2.3.4" }))).toBe(SHARED_BUCKET);
  });
});
