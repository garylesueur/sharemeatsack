import { describe, expect, it, vi } from "vitest";
import {
  copyPublicLink,
  publicEmailLink,
  publicTransferShareUrl,
  shareLinkAvailable,
  sharePublicLink,
} from "./public-sharing";

const now = Date.parse("2026-10-11T12:00:00Z");
const link = {
  url: "https://share.imeatsack.com/s/transfer-1?t=public-token_1",
  title: "Files & notes",
  expiresAt: "2026-10-11T13:00:00Z",
};

describe("public recipient link boundary", () => {
  it("constructs the canonical recipient route and required public capability", () => {
    expect(
      publicTransferShareUrl("https://share.imeatsack.com", "transfer-1", "public-token_1"),
    ).toBe(link.url);
    expect(publicTransferShareUrl("http://localhost:3041", "transfer-1", "public-token_1")).toBe(
      "http://localhost:3041/s/transfer-1?t=public-token_1",
    );
  });
  it.each([
    ["javascript:alert(1)", "transfer-1", "public-token_1"],
    ["https://user:password@share.imeatsack.com", "transfer-1", "public-token_1"],
    [
      "https://share.imeatsack.com/s/transfer-1/manage?token=private",
      "transfer-1",
      "public-token_1",
    ],
    ["https://share.imeatsack.com?file=viewer", "transfer-1", "public-token_1"],
    ["https://share.imeatsack.com", "../portal/account", "public-token_1"],
    ["https://share.imeatsack.com", "transfer-1", ""],
  ])("refuses unsafe or noncanonical construction %s", (origin, id, token) => {
    expect(publicTransferShareUrl(origin, id, token)).toBeNull();
  });
  it.each([
    "https://share.imeatsack.com/s/transfer-1/manage?token=private",
    "https://share.imeatsack.com/portal/sharemeatsack/sent/transfer-1",
    "https://storage.example/objects/file?signature=private",
    `${link.url}&file=viewer`,
    `${link.url}#page=2`,
    "https://share.imeatsack.com/s/transfer-1?token=public-token_1",
  ])("never shares a private route or viewer URL %s", (url) => {
    expect(shareLinkAvailable({ ...link, url }, now)).toBe(false);
  });
  it("refuses invalid dates and expires at the exact boundary", () => {
    expect(shareLinkAvailable(link, Date.parse(link.expiresAt))).toBe(false);
    expect(shareLinkAvailable({ ...link, expiresAt: "invalid" }, now)).toBe(false);
    expect(shareLinkAvailable(link, now)).toBe(true);
  });
});

describe("observed browser actions", () => {
  it("reports copied only after the clipboard has resolved", async () => {
    let finish!: () => void;
    const writeText = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const result = copyPublicLink(link, { writeText }, () => now);
    expect(writeText).toHaveBeenCalledWith(link.url);
    let settled = false;
    void result.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    finish();
    expect(await result).toBe("copied");
  });
  it("distinguishes unavailable clipboard and refused clipboard access", async () => {
    expect(await copyPublicLink(link, undefined, () => now)).toBe("unsupported");
    expect(
      await copyPublicLink(
        link,
        {
          writeText: async () => {
            throw new Error("denied");
          },
        },
        () => now,
      ),
    ).toBe("failed");
  });
  it("refuses sharing after expiration even while a browser action is pending", async () => {
    let current = now;
    expect(
      await copyPublicLink(
        link,
        {
          writeText: async () => {
            current = Date.parse(link.expiresAt);
          },
        },
        () => current,
      ),
    ).toBe("unavailable");
    const share = vi.fn(async () => {});
    expect(await sharePublicLink(link, { share }, () => current)).toBe("unavailable");
    expect(share).not.toHaveBeenCalled();
  });
  it("calls device sharing synchronously before yielding user activation", async () => {
    const share = vi.fn(async () => {});
    const result = sharePublicLink(link, { share }, () => now);
    expect(share).toHaveBeenCalledExactlyOnceWith({ title: link.title, url: link.url });
    expect(await result).toBe("completed");
  });
  it("separates device cancellation, failure, and unsupported share payloads", async () => {
    expect(
      await sharePublicLink(
        link,
        {
          share: async () => {
            throw new DOMException("cancelled", "AbortError");
          },
        },
        () => now,
      ),
    ).toBe("cancelled");
    expect(
      await sharePublicLink(
        link,
        {
          share: async () => {
            throw new Error("failed");
          },
        },
        () => now,
      ),
    ).toBe("failed");
    const share = vi.fn(async () => {});
    expect(await sharePublicLink(link, { share, canShare: () => false }, () => now)).toBe(
      "unsupported",
    );
    expect(share).not.toHaveBeenCalled();
  });
  it("recognizes platform cancellation without relying on an Error prototype", async () => {
    expect(
      await sharePublicLink(
        link,
        {
          share: async () => {
            throw { name: "AbortError" };
          },
        },
        () => now,
      ),
    ).toBe("cancelled");
  });
  it("email uses only a public link, encoded safely, and is unavailable after expiry", () => {
    const email = publicEmailLink(link, now);
    const query = new URLSearchParams(email!.slice("mailto:?".length));
    expect(query.get("subject")).toBe(link.title);
    expect(query.get("body")).toBe(`Files for you: ${link.url}`);
    expect(publicEmailLink(link, Date.parse(link.expiresAt))).toBeNull();
  });
});
