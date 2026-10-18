import { describe, expect, it, vi } from "vitest";
import { createReadResolver, FileAccessError } from "./file-access";

describe("Viewing B8/B9 — bounded authorised read access", () => {
  it("deduplicates concurrent reads, caches only unexpired URLs, and separates download from preview", async () => {
    let now = Date.parse("2026-10-06T12:00:00Z");
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        url: "https://storage.example/file",
        expiresAt: new Date(now + 60_000).toISOString(),
      }),
    );
    const reader = createReadResolver(
      { transferId: "one", token: "private-fixture" },
      fetcher,
      () => now,
    );
    const [a, b] = await Promise.all([
      reader.resolve("file", "preview"),
      reader.resolve("file", "preview"),
    ]);
    expect(a).toEqual(b);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await reader.resolve("file", "preview");
    expect(fetcher).toHaveBeenCalledTimes(1);
    await reader.resolve("file", "download");
    expect(fetcher).toHaveBeenCalledTimes(2);
    now += 40_000;
    await reader.resolve("file", "preview");
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({
      authorization: "Bearer private-fixture",
    });
    expect(String(fetcher.mock.calls[0][0])).not.toContain("private-fixture");
  });
  it("does not cache forbidden access or retry it automatically", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 404 }));
    const reader = createReadResolver({ transferId: "one", token: "fixture" }, fetcher);
    await expect(reader.resolve("foreign", "preview")).rejects.toMatchObject({
      denied: true,
      status: 404,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects malformed or executable read URLs", async () => {
    const reader = createReadResolver({ transferId: "one", token: "fixture" }, async () =>
      Response.json({ url: "javascript:alert(1)", expiresAt: "2026-10-07T00:00:00Z" }),
    );
    await expect(reader.resolve("file", "preview")).rejects.toBeInstanceOf(FileAccessError);
  });
});
