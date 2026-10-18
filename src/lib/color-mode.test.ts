import { describe, expect, it } from "vitest";
import { colorModeCookieDomain, persistColorModeCookie } from "./color-mode";

describe("colorModeCookieDomain", () => {
  it("shares the preference across the product subdomains", () => {
    expect(colorModeCookieDomain("share.imeatsack.com")).toBe("; Domain=.imeatsack.com");
    expect(colorModeCookieDomain("s.share.imeatsack.com")).toBe("; Domain=.imeatsack.com");
    expect(colorModeCookieDomain("ask.imeatsack.com")).toBe("; Domain=.imeatsack.com");
    expect(colorModeCookieDomain("show.imeatsack.com")).toBe("; Domain=.imeatsack.com");
    expect(colorModeCookieDomain("localhost")).toBe("");
    expect(colorModeCookieDomain("imeatsack.com.example.com")).toBe("");
  });

  it("marks the cookie Secure on https", () => {
    expect(persistColorModeCookie("dark", "share.imeatsack.com", "https:")).toContain("; Secure");
    expect(persistColorModeCookie("dark", "localhost", "http:")).not.toContain("Secure");
  });
});
