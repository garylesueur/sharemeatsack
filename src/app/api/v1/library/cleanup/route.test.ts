import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installTestObjectStore } from "@/lib/app-transfers";
import { createMemoryObjectStore } from "@/lib/object-store";
import { POST } from "./route";

const SECRET = "test-only-cleanup-secret";
function request(
  id = "removed",
  seconds = Math.floor(Date.now() / 1000),
  domain = "library-cleanup.",
) {
  const body = JSON.stringify({ id });
  const signature = createHmac("sha256", SECRET)
    .update(`${seconds}.${domain}${body}`)
    .digest("hex");
  return new Request("https://share.example/api/v1/library/cleanup", {
    method: "POST",
    headers: { "library-cleanup-signature": `t=${seconds},v1=${signature}` },
    body,
  });
}
function file() {
  return {
    id: "removed",
    accountId: "deleted-owner",
    name: "private.txt",
    contentType: "text/plain",
    size: 4,
    uploadKey: "sharemeatsack/library/removed/upload",
    objectKey: "sharemeatsack/library/removed/sealed/attempt",
    scanAttemptId: "attempt",
    createdAt: Date.now() - 7_200_000,
    uploadExpiresAt: Date.now() - 120_000,
    cleanupAt: Date.now() - 1,
    visible: false,
    state: "removing",
    references: [],
  };
}
afterEach(() => {
  installTestObjectStore(null);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("B1 storage cleanup — signed and independently authorized", () => {
  it("refuses missing, stale, tampered and scan-domain signatures before requesting authority", async () => {
    vi.stubEnv("CLEANROOM_WEBHOOK_SECRET", SECRET);
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(
      (await POST(new Request("https://share.example/cleanup", { method: "POST", body: "{}" })))
        .status,
    ).toBe(404);
    expect((await POST(request("removed", Math.floor(Date.now() / 1000) - 600))).status).toBe(404);
    expect((await POST(request("removed", Math.floor(Date.now() / 1000), ""))).status).toBe(404);
    const valid = request();
    expect(
      (
        await POST(
          new Request(valid.url, {
            method: "POST",
            headers: valid.headers,
            body: JSON.stringify({ id: "other" }),
          }),
        )
      ).status,
    ).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("cannot delete without the current metadata decision, even with the shared secret", async () => {
    vi.stubEnv("CLEANROOM_WEBHOOK_SECRET", SECRET);
    const objects = createMemoryObjectStore();
    installTestObjectStore(objects);
    const row = file();
    await objects.put(row.objectKey, new Uint8Array(4), "text/plain");
    const fetcher = vi.fn(async () => Response.json({ ok: true, file: null }));
    vi.stubGlobal("fetch", fetcher);
    expect((await POST(request())).status).toBe(409);
    expect(await objects.head(row.objectKey)).not.toBeNull();
    fetcher.mockImplementation(async () =>
      Response.json({ ok: true, file: { ...row, visible: true, state: "available" } }),
    );
    expect((await POST(request())).status).toBe(503);
    fetcher.mockImplementation(async () =>
      Response.json({ ok: true, file: { ...row, references: ["existing-send"] } }),
    );
    expect((await POST(request())).status).toBe(503);
    fetcher.mockImplementation(async () =>
      Response.json({ ok: true, file: { ...row, sealDeadlineAt: Date.now() + 30_000 } }),
    );
    expect((await POST(request())).status).toBe(503);
    expect(await objects.head(row.objectKey)).not.toBeNull();
  });
  it("cleans only frozen library keys for a deleted account, verifies storage deletion and retries a failure", async () => {
    vi.stubEnv("CLEANROOM_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("LANYARD_URL", "https://portal.example");
    const row = file();
    const objects = createMemoryObjectStore();
    installTestObjectStore(objects);
    await objects.put(row.uploadKey, new Uint8Array(4), "text/plain");
    await objects.put(row.objectKey, new Uint8Array(4), "text/plain");
    await objects.put("unrelated", new Uint8Array(4), "text/plain");
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ ok: true, file: row }));
    vi.stubGlobal("fetch", fetcher);
    const deleteSpy = vi.spyOn(objects, "delete").mockResolvedValueOnce();
    expect((await POST(request())).status).toBe(503);
    expect(await objects.head(row.objectKey)).not.toBeNull();
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(await objects.head(row.objectKey)).toBeNull();
    expect(await objects.head(row.uploadKey)).toBeNull();
    expect(await objects.head("unrelated")).not.toBeNull();
    // A PUT begun before expiry can finish after DELETE. The minimal durable
    // watch still authorizes deletion without an owner or a live library row.
    const watch = {
      id: row.id,
      uploadKey: row.uploadKey,
      objectKey: row.objectKey,
      scanAttemptId: row.scanAttemptId,
      uploadExpiresAt: row.uploadExpiresAt,
      visible: false,
      state: "removing",
      references: [],
      cleanupAt: row.cleanupAt,
    };
    fetcher.mockImplementation(async () => Response.json({ ok: true, file: watch }));
    await objects.put(row.uploadKey, new Uint8Array(4), "text/plain");
    await objects.put(row.objectKey, new Uint8Array(4), "text/plain");
    expect((await POST(request())).status).toBe(200);
    expect(await objects.head(row.uploadKey)).toBeNull();
    expect(await objects.head(row.objectKey)).toBeNull();
    expect(await objects.head("unrelated")).not.toBeNull();
    expect(String(fetcher.mock.calls[0][0])).toBe(
      "https://portal.example/api/v1/library/cleanup-authorization",
    );
    fetcher.mockImplementation(async () =>
      Response.json({ ok: true, file: { ...row, objectKey: "unrelated" } }),
    );
    expect((await POST(request())).status).toBe(503);
    expect(await objects.head("unrelated")).not.toBeNull();
    deleteSpy.mockRestore();
  });
});
