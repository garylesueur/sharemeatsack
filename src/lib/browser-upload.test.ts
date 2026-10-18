import { describe, expect, it, vi } from "vitest";
import { uploadWithRetry } from "./browser-upload";

describe("B5 — interrupted browser uploads can be retried", () => {
  it("recovers from a network rejection using a fresh URL", async () => {
    const put = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(undefined);
    const onPhase = vi.fn();
    await uploadWithRetry({
      uploadUrl: "old-url",
      put,
      refresh: async () => "fresh-url",
      onPhase,
    });
    expect(put.mock.calls).toEqual([["old-url"], ["fresh-url"]]);
    expect(onPhase.mock.calls).toEqual([["uploading"], ["retrying"]]);
  });

  it("returns a persistent storage failure after bounded attempts", async () => {
    const put = vi.fn().mockRejectedValue(new Error("Storage unavailable"));
    await expect(
      uploadWithRetry({
        uploadUrl: "url",
        put,
        refresh: async () => "fresh-url",
        onPhase: () => {},
      }),
    ).rejects.toThrow("Storage unavailable");
    expect(put).toHaveBeenCalledTimes(3);
  });
});
