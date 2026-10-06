import { describe, expect, it } from "vitest";
import { PDF_PIXEL_LIMIT, pdfRaster } from "./pdf-preview";

describe("PDF raster budget", () => {
  it("fits a normal page on mobile and respects display density", () => {
    const raster = pdfRaster(612, 792, 350, 1, 2);
    expect(raster.cssWidth).toBeCloseTo(350);
    expect(raster.width).toBe(700);
    expect(raster.limited).toBe(false);
  });
  it("caps zoomed high-density and unusually tall pages", () => {
    for (const [width, height] of [
      [612, 792],
      [100, 100_000],
      [100_000, 100],
    ]) {
      const raster = pdfRaster(width, height, 2000, 4, 3);
      expect(raster.width * raster.height).toBeLessThanOrEqual(PDF_PIXEL_LIMIT);
      expect(Math.max(raster.width, raster.height)).toBeLessThanOrEqual(16_384);
      expect(raster.limited).toBe(true);
    }
  });
  it("rejects invalid dimensions instead of allocating a broken surface", () => {
    expect(() => pdfRaster(0, 10, 100, 1, 1)).toThrow("unsupported dimensions");
    expect(() => pdfRaster(10, Number.POSITIVE_INFINITY, 100, 1, 1)).toThrow();
  });
});
