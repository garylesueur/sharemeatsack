import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryObjectStore, createR2ObjectStore } from "./object-store";

const config = {
  accountId: "test-account",
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
  bucket: "test-bucket",
  endpoint: "https://test-account.r2.cloudflarestorage.com",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Workspace B1 — sealed library objects", () => {
  it("atomically refuses a changed source instead of copying unreserved bytes", async () => {
    const store = createMemoryObjectStore();
    await store.put("source", new Uint8Array([1]), "text/plain");
    const expected = await store.headVersion!("source");
    await store.put("source", new Uint8Array([1, 2, 3]), "text/plain");
    await expect(store.copyVersion!("source", "target", expected!)).rejects.toThrow("changed");
    expect(await store.head("target")).toBeNull();
    await store.copyVersion!("source", "target", (await store.headVersion!("source"))!);
    expect(await store.head("target")).toEqual({ size: 3 });
  });

  it("uses provider atomic source conditions and refuses precondition failure", async () => {
    const requests: Request[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: Request) => {
        requests.push(request);
        return new Response(null, { status: 412 });
      }),
    );
    const store = createR2ObjectStore(config);
    await expect(
      store.copyVersion!("source", "target", { size: 1, version: '"observed-version"' }),
    ).rejects.toThrow("could not seal");
    expect(requests[0].headers.get("x-amz-copy-source-if-match")).toBe('"observed-version"');
    expect(requests[0].body).toBeNull();
  });

  it("binds library upload capabilities to the reserved size and offered type", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-10T20:00:00.000Z"));
    const store = createR2ObjectStore(config);
    const input = {
      key: "sharemeatsack/library/reserved-file/upload",
      contentType: "text/plain",
      contentLength: 1,
    };
    const offered = new URL((await store.presignPut(input)).url);
    const larger = new URL((await store.presignPut({ ...input, contentLength: 2 })).url);
    const changedType = new URL(
      (await store.presignPut({ ...input, contentType: "application/octet-stream" })).url,
    );
    // B1's reservation must constrain the actual PUT, including staging overwrites.
    expect(offered.searchParams.get("X-Amz-SignedHeaders")?.split(";")).toEqual([
      "content-length",
      "content-type",
      "host",
    ]);
    expect(larger.searchParams.get("X-Amz-Signature")).not.toBe(
      offered.searchParams.get("X-Amz-Signature"),
    );
    expect(changedType.searchParams.get("X-Amz-Signature")).not.toBe(
      offered.searchParams.get("X-Amz-Signature"),
    );
  });

  it("keeps a separate snapshot when the original upload is overwritten", async () => {
    const store = createMemoryObjectStore();
    await store.put("upload", new Uint8Array([1, 2]), "application/octet-stream");
    await store.copy("upload", "sealed");
    await store.put("upload", new Uint8Array([9, 9]), "application/octet-stream");
    expect((await store.get("sealed"))?.body).toEqual(new Uint8Array([1, 2]));
    await expect(store.copy("missing", "other")).rejects.toThrow("unavailable");
    await expect(store.copy("sealed", "sealed")).rejects.toThrow("separate key");
  });

  it("copies within storage and refuses rejected or incomplete copy results", async () => {
    const requests: Request[] = [];
    let result = new Response("<CopyObjectResult><ETag>test</ETag></CopyObjectResult>");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: Request) => {
        requests.push(request);
        return result;
      }),
    );
    const store = createR2ObjectStore(config);
    await store.copy("upload/résumé.txt", "sealed/file");
    expect(requests[0].headers.get("x-amz-copy-source")).toBe(
      "/test-bucket/upload/r%C3%A9sum%C3%A9.txt",
    );
    expect(requests[0].body).toBeNull();
    result = new Response("<Error><Code>CopyFailed</Code></Error>");
    await expect(store.copy("upload", "sealed")).rejects.toThrow("did not confirm");
    result = new Response(null, { status: 403 });
    await expect(store.copy("upload", "sealed")).rejects.toThrow("could not seal");
  });
});

describe("R2 object metadata", () => {
  it("binds a sealed snapshot to an opaque provider identity without reading file bytes", async () => {
    const requests: Request[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: Request) => {
        requests.push(request);
        return new Response(null, {
          headers: { "Content-Length": "4", ETag: '"provider-version"' },
        });
      }),
    );
    const store = createR2ObjectStore(config);
    expect(await store.headVersion!("sealed")).toEqual({ size: 4, version: '"provider-version"' });
    expect(requests[0].method).toBe("HEAD");
    expect(requests[0].body).toBeNull();
    expect(requests[0].headers.get("accept-encoding")).toBe("identity");
  });

  it.each([undefined, 'W/"weak"', "unquoted", '"bad\nidentity"'])(
    "refuses a missing or unusable object identity (%s)",
    async (etag) => {
      const headers = new Headers({ "Content-Length": "1" });
      // Headers themselves reject control characters before reaching the provider port.
      if (etag?.includes("\n")) return expect(() => headers.set("ETag", etag)).toThrow();
      if (etag !== undefined) headers.set("ETag", etag);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(null, { headers })),
      );
      await expect(createR2ObjectStore(config).headVersion!("sealed")).rejects.toThrow(
        "invalid object identity",
      );
    },
  );

  it("changes local identity on overwrite while the independent snapshot keeps its identity", async () => {
    const store = createMemoryObjectStore();
    await store.put("source", new Uint8Array([1]), "text/plain");
    await store.copy("source", "sealed");
    const original = await store.headVersion!("source");
    const sealed = await store.headVersion!("sealed");
    await store.put("source", new Uint8Array([2]), "text/plain");
    expect(await store.headVersion!("source")).not.toEqual(original);
    expect(await store.headVersion!("sealed")).toEqual(sealed);
    expect(await store.headVersion!("missing")).toBeNull();
  });

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
