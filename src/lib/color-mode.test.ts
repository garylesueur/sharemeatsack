import { describe, expect, it } from "vitest";
import { colorModeCookieDomain, persistColorModeCookie } from "./color-mode";

describe("colorModeCookieDomain", () => {
  it("scopes the cookie to the product origin", () => {
    expect(colorModeCookieDomain("sharemeatsack.com")).toBe("; Domain=.sharemeatsack.com");
    expect(colorModeCookieDomain("s.sharemeatsack.com")).toBe("; Domain=.sharemeatsack.com");
    expect(colorModeCookieDomain("askmeatsack.com")).toBe("; Domain=.askmeatsack.com");
    expect(colorModeCookieDomain("showmeatsack.com")).toBe("; Domain=.showmeatsack.com");
    expect(colorModeCookieDomain("localhost")).toBe("");
  });

  it("marks the cookie Secure on https", () => {
    expect(persistColorModeCookie("dark", "sharemeatsack.com", "https:")).toContain("; Secure");
    expect(persistColorModeCookie("dark", "localhost", "http:")).not.toContain("Secure");
  });
});
