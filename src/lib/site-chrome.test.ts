import { afterEach, describe, expect, it, vi } from "vitest";
import { siteChromeProps } from "./site-chrome";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("site chrome", () => {
  it("keeps Share selected in the family navigation on home and transfer pages", () => {
    expect(siteChromeProps().product).toBe("share");
  });

  it("offers Sign in on lanyard only when LANYARD_URL is set", () => {
    vi.stubEnv("LANYARD_URL", "");
    expect(siteChromeProps().accountHref).toBeUndefined();
    vi.stubEnv("LANYARD_URL", "https://lanyard.test/");
    expect(siteChromeProps().accountHref).toBe(
      "https://lanyard.test/sign-in?product=sharemeatsack",
    );
  });
});
