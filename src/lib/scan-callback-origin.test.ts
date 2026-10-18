import { afterEach, describe, expect, it, vi } from "vitest";
import { publicOrigin } from "./public-origin";
import { scanCallbackOrigin } from "./scan-callback-origin";

afterEach(() => vi.unstubAllEnvs());

describe("scanner callback origin", () => {
  it("defaults to the product's public origin", () => {
    vi.stubEnv("CLEANROOM_CALLBACK_BASE_URL", "");
    vi.stubEnv("PUBLIC_BASE_URL", "https://share.imeatsack.com");
    expect(scanCallbackOrigin()).toBe(publicOrigin());
  });

  it("uses the HTTPS callback origin without changing local public links", () => {
    vi.stubEnv("PUBLIC_BASE_URL", "http://localhost:3041");
    vi.stubEnv("CLEANROOM_CALLBACK_BASE_URL", "https://scanner-return.example/");
    expect(scanCallbackOrigin()).toBe("https://scanner-return.example");
    expect(publicOrigin()).toBe("http://localhost:3041");
  });

  it.each([
    "http://scanner-return.example",
    "https://user:password@scanner-return.example",
    "https://scanner-return.example/path",
    "https://scanner-return.example?token=example",
    "https://scanner-return.example#fragment",
    "not-a-url",
  ])("refuses a callback setting that is not a bare HTTPS origin: %s", (value) => {
    vi.stubEnv("CLEANROOM_CALLBACK_BASE_URL", value);
    expect(() => scanCallbackOrigin()).toThrow();
  });
});
