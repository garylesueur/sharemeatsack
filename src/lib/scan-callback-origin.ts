import { publicOrigin } from "./public-origin";

/** Allows a local app to receive scanner results without changing its public links. */
export function scanCallbackOrigin(): string {
  const configured = process.env.CLEANROOM_CALLBACK_BASE_URL;
  if (!configured) return publicOrigin();
  const url = new URL(configured);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("CLEANROOM_CALLBACK_BASE_URL must be an HTTPS origin");
  }
  return url.origin;
}
