import { afterEach, describe, expect, it, vi } from "vitest";
import { createR2ObjectStore } from "./object-store";

const config = {
  accountId: "test-account",
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
  bucket: "test-bucket",
  endpoint: "https://test-account.r2.cloudflarestorage.com",
};

afterEach(() => vi.unstubAllGlobals());

describe("R2 object metadata", () => {
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

      expect(await createR2ObjectStore(config).head("verification.txt")).toBeNull();
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
