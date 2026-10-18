import { describe, expect, it } from "vitest";
import { incomingSaveUrl } from "./public-sharing";

describe("public incoming Save entry", () => {
  it("keeps only the canonical public URL in the fixed portal fragment", () => {
    const publicUrl = "https://share.imeatsack.com/s/send?t=recipient-proof";
    const result = incomingSaveUrl("https://meatsack.puregaz.com", publicUrl)!;
    const url = new URL(result);
    expect(url.origin).toBe("https://meatsack.puregaz.com");
    expect(url.pathname).toBe("/save/sharemeatsack");
    expect(url.search).toBe("");
    expect(decodeURIComponent(url.hash.slice("#url=".length))).toBe(publicUrl);
  });
  it("refuses private/manage/viewer/storage links and misconfigured redirect origins", () => {
    for (const link of [
      "https://share.imeatsack.com/s/send/manage?k=private-proof",
      "https://storage.example/object?sig=private",
      "https://share.imeatsack.com/s/send?t=recipient-proof&viewer=grid",
    ])
      expect(incomingSaveUrl("https://meatsack.puregaz.com", link)).toBeNull();
    expect(
      incomingSaveUrl(
        "https://user:pass@portal.example",
        "https://share.imeatsack.com/s/send?t=recipient-proof",
      ),
    ).toBeNull();
    expect(
      incomingSaveUrl(
        "https://portal.example/redirect?url=external",
        "https://share.imeatsack.com/s/send?t=recipient-proof",
      ),
    ).toBeNull();
  });
});
