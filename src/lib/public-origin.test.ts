import { afterEach, describe, expect, it } from "vitest";
import { PRODUCT_ORIGIN } from "./product";
import { publicOrigin } from "./public-origin";

describe("publicOrigin", () => {
  const previous = process.env.PUBLIC_BASE_URL;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.PUBLIC_BASE_URL;
    } else {
      process.env.PUBLIC_BASE_URL = previous;
    }
  });

  it("uses PUBLIC_BASE_URL when set, without a trailing slash", () => {
    process.env.PUBLIC_BASE_URL = "http://localhost:3000/";
    expect(publicOrigin()).toBe("http://localhost:3000");
  });

  it("falls back to the product origin", () => {
    delete process.env.PUBLIC_BASE_URL;
    expect(publicOrigin()).toBe(PRODUCT_ORIGIN);
  });
});
