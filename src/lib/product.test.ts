import { describe, expect, it } from "vitest";
import { PRODUCT_NAME, PRODUCT_ORIGIN, PRODUCT_SENTENCE } from "./product";

describe("product", () => {
  it("is share.imeatsack.com", () => {
    expect(PRODUCT_NAME).toBe("share.imeatsack.com");
    expect(PRODUCT_ORIGIN).toBe("https://share.imeatsack.com");
    expect(PRODUCT_SENTENCE).toMatch(/shares files/);
  });
});
