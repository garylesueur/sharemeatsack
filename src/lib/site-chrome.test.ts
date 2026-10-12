import { describe, expect, it } from "vitest";
import { siteChromeProps } from "./site-chrome";

describe("site chrome", () => {
  it("keeps Share selected in the family navigation on home and transfer pages", () => {
    expect(siteChromeProps().product).toBe("share");
  });
});
