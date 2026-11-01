import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getDefaultTransferService,
  installTestObjectStore,
  installTestTransferStore,
} from "@/lib/app-transfers";
import { resetLanyardVerifier } from "@/lib/lanyard";
import { createMemoryObjectStore } from "@/lib/object-store";
import { createMemoryTransferStore, type TransferStore } from "@/lib/transfer-store";
import { GET as status } from "./[transferId]/route";
import { POST as registerFiles } from "./[transferId]/files/route";
import { POST } from "./route";

const LANYARD = "https://lanyard.test";
const fetchMock = vi.fn<typeof fetch>();
let store: TransferStore;
let caller = 0;

beforeEach(() => {
  store = createMemoryTransferStore();
  installTestTransferStore(store);
  installTestObjectStore(createMemoryObjectStore());
  resetLanyardVerifier();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  installTestObjectStore(null);
  resetLanyardVerifier();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

function create(body: object, authorization?: string): Promise<Response> {
  caller += 1;
  return POST(
    new Request("http://localhost/api/v1/transfers", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // A fresh address per call keeps the create rate limit out of the way.
        "x-vercel-forwarded-for": `192.0.2.${caller}`,
        ...(authorization ? { authorization } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

const aRequest = { action: "request", title: "Passport scan" };
const aSend = {
  action: "send",
  title: "Invoices",
  files: [{ name: "invoice.pdf", type: "application/pdf", size: 3 }],
};

function lanyardSays(status: number, body?: object): void {
  fetchMock.mockResolvedValue(
    new Response(body ? JSON.stringify(body) : null, {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("anonymous transfers do not depend on lanyard", () => {
  for (const [label, configure] of [
    ["LANYARD_URL unset", () => vi.stubEnv("LANYARD_URL", "")],
    [
      "lanyard unreachable",
      () => {
        vi.stubEnv("LANYARD_URL", LANYARD);
        fetchMock.mockRejectedValue(new TypeError("fetch failed"));
      },
    ],
  ] as const) {
    it(`sends, requests, opens, uploads and reads status with ${label}`, async () => {
      configure();

      const requested = await create(aRequest);
      expect(requested.status).toBe(201);
      const { transferId } = (await requested.json()) as { transferId: string };
      const saved = await store.getById(transferId);
      expect(saved?.account).toBeUndefined();

      // The person opens the link and offers a file. Bearer here is the
      // transfer's own token, never a lanyard one.
      const opened = await getDefaultTransferService().getForPublic({
        transferId,
        publicToken: saved!.publicToken,
      });
      expect(opened).toMatchObject({ kind: "request", status: "open" });
      const offered = await registerFiles(
        new Request(`http://localhost/api/v1/transfers/${transferId}/files`, {
          method: "POST",
          headers: { authorization: `Bearer ${saved!.publicToken}` },
          body: JSON.stringify({ files: [{ name: "passport.jpg", size: 3 }] }),
        }),
        { params: Promise.resolve({ transferId }) },
      );
      expect(offered.status).toBe(201);

      const sent = await create(aSend);
      expect(sent.status).toBe(201);
      const send = (await sent.json()) as { transferId: string };
      const agentToken = (await store.getById(send.transferId))!.agentToken;
      const polled = await status(
        new Request(`http://localhost/api/v1/transfers/${send.transferId}`, {
          headers: { authorization: `Bearer ${agentToken}` },
        }),
        { params: Promise.resolve({ transferId: send.transferId }) },
      );
      expect(polled.status).toBe(200);

      expect(fetchMock).not.toHaveBeenCalled();
    });
  }

  it("ignores a Bearer token on create when LANYARD_URL is unset, as before", async () => {
    vi.stubEnv("LANYARD_URL", "");
    const response = await create(aRequest, "Bearer anything-at-all");
    expect(response.status).toBe(201);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("a lanyard token on create", () => {
  beforeEach(() => {
    vi.stubEnv("LANYARD_URL", `${LANYARD}/`);
  });

  it("records the accepted account on the new transfer", async () => {
    lanyardSays(200, { account: "acct_simon" });
    const response = await create(aSend, "Bearer lanyard-token");
    expect(response.status).toBe(201);
    const { transferId } = (await response.json()) as { transferId: string };
    expect((await store.getById(transferId))?.account).toBe("acct_simon");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${LANYARD}/api/v1/verify`);
    expect(JSON.parse(init!.body as string)).toEqual({
      token: "lanyard-token",
      product: "sharemeatsack",
    });
  });

  it("treats a reused transfer token on create as anonymous, without asking lanyard", async () => {
    const first = await create(aSend);
    const { transferId } = (await first.json()) as { transferId: string };
    const agentToken = (await store.getById(transferId))!.agentToken;

    const response = await create(aRequest, `Bearer ${agentToken}`);
    expect(response.status).toBe(201);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a token lanyard rejects and creates nothing", async () => {
    lanyardSays(401);
    const response = await create(aRequest, "Bearer revoked");
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "unauthorized" } });
  });

  it("keeps a verified token working for five minutes while lanyard is down, then refuses", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-01T12:00:00Z"));
    lanyardSays(200, { account: "acct_simon" });
    expect((await create(aRequest, "Bearer lanyard-token")).status).toBe(201);

    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    vi.setSystemTime(new Date("2026-11-01T12:04:00Z"));
    const graced = await create(aRequest, "Bearer lanyard-token");
    expect(graced.status).toBe(201);
    const { transferId } = (await graced.json()) as { transferId: string };
    expect((await store.getById(transferId))?.account).toBe("acct_simon");

    expect((await create(aRequest, "Bearer never-verified")).status).toBe(401);

    vi.setSystemTime(new Date("2026-11-01T12:06:00Z"));
    expect((await create(aRequest, "Bearer lanyard-token")).status).toBe(401);
  });
});
