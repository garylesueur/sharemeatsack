export const PDF_BYTE_LIMIT = 50 * 1024 * 1024;
export const PDF_PAGE_LIMIT = 500;
export const PDF_PIXEL_LIMIT = 16_000_000;

// Zoom is relative to the fitted page. Physical canvas pixels (including DPR)
// obey the raster budget, even on very tall pages and high-density displays.
export function pdfRaster(
  width: number,
  height: number,
  available: number,
  zoom: number,
  dpr: number,
) {
  if (![width, height, available, zoom, dpr].every((value) => Number.isFinite(value) && value > 0))
    throw new Error("This PDF page has unsupported dimensions.");
  const fit = Math.min(1.5, available / width);
  const desired = fit * Math.max(0.25, Math.min(4, zoom));
  const density = Math.max(1, Math.min(3, dpr));
  const physical = Math.min(
    desired * density,
    Math.sqrt(PDF_PIXEL_LIMIT / (width * height)),
    16_384 / Math.max(width, height),
  );
  return {
    scale: physical,
    width: Math.max(1, Math.floor(width * physical)),
    height: Math.max(1, Math.floor(height * physical)),
    cssWidth: (width * physical) / density,
    cssHeight: (height * physical) / density,
    limited: physical < desired * density,
  };
}
