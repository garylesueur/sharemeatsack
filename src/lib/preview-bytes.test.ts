import { describe, expect, it, vi } from "vitest";
import { imageSlot, readPreviewBytes, StorageReadError } from "./preview-bytes";
describe("bounded storage previews", () => {
  it("cancels early when a complete-line endpoint occurs within a chunk", async () => {
    const cancel = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new Uint8Array([65, 10, 66, 10, 67]));
              },
              cancel,
            }),
          ),
      ),
    );
    try {
      expect(
        await readPreviewBytes(
          "https://storage.example/file",
          100,
          new AbortController().signal,
          () => 2,
        ),
      ).toEqual(new Uint8Array([65, 10]));
      expect(cancel).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("stops and cancels when storage ignores Range", async () => {
    const cancel = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(c) {
                c.enqueue(new Uint8Array(100));
              },
              cancel,
            }),
          ),
      ),
    );
    try {
      expect(
        (await readPreviewBytes("https://storage.example/file", 12, new AbortController().signal))
          .length,
      ).toBe(12);
      expect(cancel).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("reads an empty original from a zero-length range response without hiding other 416 failures", async () => {
    const fetcher = vi.fn(
      async () => new Response(null, { status: 416, headers: { "content-range": "bytes */0" } }),
    );
    vi.stubGlobal("fetch", fetcher);
    try {
      expect(
        await readPreviewBytes("https://storage.example/empty", 100, new AbortController().signal),
      ).toEqual(new Uint8Array());
      await Promise.all(
        ["bytes */10", ""].map((range) => {
          fetcher.mockImplementationOnce(
            async () => new Response(null, { status: 416, headers: { "content-range": range } }),
          );
          return expect(
            readPreviewBytes("https://storage.example/file", 100, new AbortController().signal),
          ).rejects.toMatchObject({ status: 416 });
        }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("keeps the storage status for access recovery", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 403 })),
    );
    try {
      await expect(
        readPreviewBytes("https://storage.example/file", 12, new AbortController().signal),
      ).rejects.toBeInstanceOf(StorageReadError);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("shares four image slots and releases cancelled queued work", async () => {
    let active = 0,
      max = 0;
    const finish: Array<() => void> = [];
    const jobs = Array.from({ length: 8 }, () =>
      imageSlot(new AbortController().signal, async () => {
        active++;
        max = Math.max(max, active);
        await new Promise<void>((r) => finish.push(r));
        active--;
      }),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(max).toBe(4);
    while (finish.length) {
      finish.shift()?.();
      await new Promise((r) => setTimeout(r, 0));
    }
    await Promise.all(jobs);
    expect(active).toBe(0);
    expect(max).toBe(4);
  });
});
