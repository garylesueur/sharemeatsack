import { describe, expect, it } from "vitest";
import { SIBLING, siteChromeProps } from "./site-chrome";
import { PRODUCT_NAME } from "./product";

describe("site chrome", () => {
  it("names ask.imeatsack.com as the sibling and share.imeatsack.com as the wordmark", () => {
    expect(SIBLING).toEqual({
      name: "ask.imeatsack.com",
      href: "https://ask.imeatsack.com",
    });
    expect(siteChromeProps().wordmark).toBe(PRODUCT_NAME);
  });
});
