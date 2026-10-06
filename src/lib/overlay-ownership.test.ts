import { describe, expect, it } from "vitest";
import { createOverlayOwnership } from "./overlay-ownership";
describe("nested viewer ownership", () => {
  it.each(["outer-first", "inner-first"])("restores base state with %s cleanup", (order) => {
    const style = { overflow: "auto" },
      footer = { inert: false },
      header = { inert: false },
      alreadyInert = { inert: true };
    const owner = createOverlayOwnership<{ inert: boolean }>(style);
    const outer = owner.hold([footer, alreadyInert]);
    const inner = owner.hold([footer, header]);
    const first = order === "outer-first" ? outer : inner,
      last = order === "outer-first" ? inner : outer;
    first();
    expect(style.overflow).toBe("hidden");
    expect(footer.inert).toBe(true);
    last();
    expect(style.overflow).toBe("auto");
    expect(footer.inert).toBe(false);
    expect(header.inert).toBe(false);
    expect(alreadyInert.inert).toBe(true);
    last();
    expect(style.overflow).toBe("auto");
  });
});
