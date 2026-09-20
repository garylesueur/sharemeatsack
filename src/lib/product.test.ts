import { describe, expect, it } from "vitest";
import { PRODUCT_NAME, PRODUCT_ORIGIN, PRODUCT_SENTENCE } from "./product";

describe("product", () => {
  it("is sharemeatsack.com", () => {
    expect(PRODUCT_NAME).toBe("sharemeatsack.com");
    expect(PRODUCT_ORIGIN).toBe("https://sharemeatsack.com");
    expect(PRODUCT_SENTENCE).toMatch(/shares files/);
  });
});
