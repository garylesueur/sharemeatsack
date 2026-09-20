import { describe, expect, it } from "vitest";
import { SIBLING, siteChromeProps } from "./site-chrome";
import { PRODUCT_NAME } from "./product";

describe("site chrome", () => {
  it("names askmeatsack.com as the sibling and sharemeatsack.com as the wordmark", () => {
    expect(SIBLING).toEqual({
      name: "askmeatsack.com",
      href: "https://askmeatsack.com",
    });
    expect(siteChromeProps().wordmark).toBe(PRODUCT_NAME);
  });
});
