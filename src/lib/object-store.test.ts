import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryObjectStore, createR2ObjectStore } from "./object-store";

const config = {
  accountId: "test-account",
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
  bucket: "test-bucket",
  endpoint: "https://test-account.r2.cloudflarestorage.com",
};

afterEach(() => vi.unstubAllGlobals());

describe("R2 object metadata", () => {
  it("distinguishes a missing object from a transient or rejected metadata read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    expect(await createR2ObjectStore(config).head("file")).toBeNull();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 })),
    );
    await expect(createR2ObjectStore(config).head("file")).rejects.toThrow(
      "Storage metadata is unavailable",
    );
  });
  it("gets the original size when compression would omit Content-Length", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (request: Request) =>
          new Response(null, {
            headers:
              request.headers.get("accept-encoding") === "identity"
                ? { "Content-Length": "69" }
                : { "Content-Encoding": "gzip" },
          }),
      ),
    );

    expect(await createR2ObjectStore(config).head("verification.txt")).toEqual({ size: 69 });
  });

  it.each([null, "", "invalid", "-1"])(
    "does not treat an unusable length (%s) as a stored file size",
    async (length) => {
      const headers = new Headers();
      if (length !== null) headers.set("Content-Length", length);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(null, { headers })),
      );

      await expect(createR2ObjectStore(config).head("verification.txt")).rejects.toThrow(
        "Storage returned invalid file metadata",
      );
    },
  );

  it("recognizes an explicitly empty object", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { headers: { "Content-Length": "0" } })),
    );

    expect(await createR2ObjectStore(config).head("empty.txt")).toEqual({ size: 0 });
  });
});

describe("Viewing B8/B9 — storage read capabilities", () => {
  it("signs safe original-download headers including a UTF-8 filename", async () => {
    const result = await createR2ObjectStore(config).presignGet({
      key: "original",
      filename: 'résumé"\r\n.pdf',
      contentType: "application/pdf",
    });
    const url = new URL(result.url);
    expect(url.searchParams.get("response-content-disposition")).toBe(
      "attachment; filename=\"r_sum____.pdf\"; filename*=UTF-8''r%C3%A9sum%C3%A9%22__.pdf",
    );
    expect(url.searchParams.get("response-content-type")).toBe("application/pdf");
    expect(url.searchParams.get("response-cache-control")).toBe("private, no-store");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[a-f0-9]{64}$/);
  });

  it("offers media inline, while active preview content remains inert", async () => {
    const store = createR2ObjectStore(config);
    const video = new URL(
      (
        await store.presignGet({
          key: "video",
          filename: "movie.mp4",
          contentType: "video/mp4",
          purpose: "preview",
        })
      ).url,
    );
    expect(video.searchParams.get("response-content-type")).toBe("video/mp4");
    expect(video.searchParams.get("response-content-disposition")).toMatch(/^inline;/);
    const active = new URL(
      (
        await store.presignGet({
          key: "active",
          filename: "page.html",
          contentType: "text/html",
          purpose: "preview",
        })
      ).url,
    );
    expect(active.searchParams.get("response-content-type")).toBe("text/plain");
  });

  it("expires local read grants and cannot broaden access by editing the key or response parameters", async () => {
    let now = new Date("2026-10-06T12:00:00.000Z");
    const store = createMemoryObjectStore(() => now);
    const result = await store.presignGet({
      key: "private",
      filename: "original.txt",
      contentType: "text/plain",
      expiresInSeconds: 10,
    });
    const url = new URL(result.url, "http://localhost");
    expect(store.authorizeRead?.("private", url)?.contentDisposition).toMatch(/^attachment;/);
    expect(store.authorizeRead?.("other", url)).toBeNull();
    url.searchParams.set("name", "active.html");
    url.searchParams.set("purpose", "preview");
    expect(store.authorizeRead?.("private", url)?.contentDisposition).toContain("original.txt");
    now = new Date("2026-10-06T12:00:10.000Z");
    expect(store.authorizeRead?.("private", url)).toBeNull();
    expect(
      store.authorizeRead?.("private", new URL("http://localhost/api/v1/objects/private")),
    ).toBeNull();
  });
});
