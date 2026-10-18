import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installTestObjectStore } from "@/lib/app-transfers";
import { createMemoryObjectStore } from "@/lib/object-store";
import { POST } from "./route";
const SECRET = "test-only-callback-secret";
const payload = JSON.stringify({
  handle: "scan-one",
  verdict: { verdict: "infected", signature: "test" },
});
function signed(seconds = Math.floor(Date.now() / 1000), body = payload) {
  const hash = createHmac("sha256", SECRET).update(`${seconds}.${body}`).digest("hex");
  return new Request("https://share.example/api/v1/library/scan-result", {
    method: "POST",
    headers: { "cleanroom-signature": `t=${seconds},v1=${hash}` },
    body,
  });
}
afterEach(() => {
  installTestObjectStore(null);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("Private library scanner callback", () => {
  it("refuses missing, tampered and old signatures without forwarding or deleting bytes", async () => {
    vi.stubEnv("CLEANROOM_WEBHOOK_SECRET", SECRET);
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const missing = new Request("https://share.example/callback", {
      method: "POST",
      body: payload,
    });
    expect((await POST(missing)).status).toBe(404);
    expect((await POST(signed(Math.floor(Date.now() / 1000) - 600))).status).toBe(404);
    const valid = signed();
    expect(
      (
        await POST(
          new Request(valid.url, { method: "POST", headers: valid.headers, body: payload + " " }),
        )
      ).status,
    ).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("deletes an infected sealed object only after verified metadata accepts the receipt", async () => {
    vi.stubEnv("CLEANROOM_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("LANYARD_URL", "https://portal.example");
    const objects = createMemoryObjectStore();
    installTestObjectStore(objects);
    const file = {
      id: "file",
      accountId: "owner",
      name: "bad.bin",
      contentType: "application/octet-stream",
      size: 4,
      createdAt: Date.now(),
      uploadExpiresAt: Date.now() + 1000,
      visible: true,
      state: "blocked",
      scanStatus: "infected",
      scanAttemptId: "attempt",
      objectKey: "sharemeatsack/library/file/sealed/attempt",
      uploadKey: "sharemeatsack/library/file/upload",
      references: [],
    };
    await objects.put(file.objectKey, new Uint8Array(4), file.contentType);
    await objects.put(file.uploadKey, new Uint8Array(4), file.contentType);
    const fetcher = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ ok: true, file: null }),
    );
    vi.stubGlobal("fetch", fetcher);
    expect((await POST(signed())).status).toBe(200);
    expect(await objects.head(file.objectKey)).not.toBeNull();
    fetcher.mockResolvedValue(Response.json({ ok: true, file }));
    const response = await POST(signed());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(await objects.head(file.objectKey)).toBeNull();
    expect(await objects.head(file.uploadKey)).toBeNull();
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      "https://portal.example/api/v1/library/scan-result",
    );
  });
  it("preserves referenced bytes and refuses unexpected storage keys", async () => {
    vi.stubEnv("CLEANROOM_WEBHOOK_SECRET", SECRET);
    const objects = createMemoryObjectStore();
    installTestObjectStore(objects);
    await objects.put("foreign-key", new Uint8Array(4), "text/plain");
    const file = {
      id: "file",
      accountId: "owner",
      name: "bad.bin",
      contentType: "application/octet-stream",
      size: 4,
      createdAt: Date.now(),
      uploadExpiresAt: Date.now() + 1000,
      visible: true,
      state: "blocked",
      scanStatus: "infected",
      scanAttemptId: "attempt",
      objectKey: "foreign-key",
      uploadKey: "sharemeatsack/library/file/upload",
      references: ["send"],
    };
    const fetcher = vi.fn<typeof globalThis.fetch>(async () => Response.json({ ok: true, file }));
    vi.stubGlobal("fetch", fetcher);
    expect((await POST(signed())).status).toBe(200);
    expect(await objects.head("foreign-key")).not.toBeNull();
    fetcher.mockResolvedValue(Response.json({ ok: true, file: { ...file, references: [] } }));
    expect((await POST(signed())).status).toBe(503);
    expect(await objects.head("foreign-key")).not.toBeNull();
  });
});
