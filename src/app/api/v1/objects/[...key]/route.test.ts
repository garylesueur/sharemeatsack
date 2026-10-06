import { afterEach, describe, expect, it, vi } from "vitest";
import { installTestObjectStore } from "@/lib/app-transfers";
import { createMemoryObjectStore } from "@/lib/object-store";
import { GET, HEAD } from "./route";

afterEach(() => {
  installTestObjectStore(null);
  vi.unstubAllEnvs();
});

async function fixture() {
  vi.stubEnv("R2_ACCOUNT_ID", "");
  vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "");
  let now = new Date("2026-10-06T12:00:00.000Z");
  const store = createMemoryObjectStore(() => now);
  installTestObjectStore(store);
  await store.put("file", new TextEncoder().encode("0123456789"), "text/plain");
  const signed = await store.presignGet({
    key: "file",
    filename: "source.txt",
    contentType: "text/plain",
    purpose: "preview",
    expiresInSeconds: 10,
  });
  return {
    store,
    url: `http://localhost${signed.url}`,
    context: { params: Promise.resolve({ key: ["file"] }) },
    expire: () => {
      now = new Date("2026-10-06T12:00:10.000Z");
    },
  };
}

describe("Viewing B8/B12 — local fixture reads mirror safe storage access", () => {
  it("serves original bytes with inert headers, HEAD metadata, and byte/suffix ranges", async () => {
    const { url, context } = await fixture();
    const full = await GET(new Request(url), context);
    expect(await full.text()).toBe("0123456789");
    expect(full.headers.get("cache-control")).toBe("private, no-store");
    expect(full.headers.get("content-security-policy")).toContain("sandbox");
    expect(full.headers.get("x-content-type-options")).toBe("nosniff");
    const head = await HEAD(new Request(url), context);
    expect(head.headers.get("content-length")).toBe("10");
    expect(await head.text()).toBe("");
    await Promise.all(
      [
        ["bytes=2-5", "2345", "bytes 2-5/10"],
        ["bytes=-3", "789", "bytes 7-9/10"],
        ["bytes=8-", "89", "bytes 8-9/10"],
      ].map(async ([range, expected, contentRange]) => {
        const response = await GET(new Request(url, { headers: { Range: range! } }), context);
        expect(response.status).toBe(206);
        expect(response.headers.get("content-range")).toBe(contentRange);
        expect(await response.text()).toBe(expected);
      }),
    );
    const invalid = await GET(new Request(url, { headers: { Range: "bytes=12-20" } }), context);
    expect(invalid.status).toBe(416);
    expect(invalid.headers.get("content-range")).toBe("bytes */10");
  });

  it("refuses unsigned, expired, foreign-object and missing-object access", async () => {
    const { store, url, context, expire } = await fixture();
    expect((await GET(new Request("http://localhost/api/v1/objects/file"), context)).status).toBe(
      404,
    );
    expect(
      (await GET(new Request(url), { params: Promise.resolve({ key: ["foreign"] }) })).status,
    ).toBe(404);
    await store.delete("file");
    expect((await GET(new Request(url), context)).status).toBe(404);
    await store.put("file", new Uint8Array([1]), "text/plain");
    expire();
    expect((await HEAD(new Request(url), context)).status).toBe(404);
  });

  it("disables the local byte endpoint with configured R2", async () => {
    const { url, context } = await fixture();
    vi.stubEnv("R2_ACCOUNT_ID", "configured");
    vi.stubEnv("R2_ACCESS_KEY_ID", "configured");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "configured");
    vi.stubEnv("R2_BUCKET_NAME", "configured");
    expect((await GET(new Request(url), context)).status).toBe(404);
  });
});
