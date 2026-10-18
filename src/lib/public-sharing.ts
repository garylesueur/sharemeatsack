export type PublicShareLink = { url: string; title: string; expiresAt: string };

/** Construct from verified public access, never from the current viewer or a manage URL. */
export function publicTransferShareUrl(origin: string, transferId: string, token: string) {
  try {
    const base = new URL(origin);
    if (
      !["https:", "http:"].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      base.pathname !== "/" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(transferId) ||
      !/^[A-Za-z0-9_-]{1,256}$/.test(token)
    )
      return null;
    const url = new URL(`/s/${transferId}`, base);
    url.searchParams.set("t", token);
    return url.href;
  } catch {
    return null;
  }
}

/** The recipient capability stays in a fragment and never becomes an authentication redirect. */
export function incomingSaveUrl(portalOrigin: string, publicUrl: string) {
  try {
    const portal = new URL(portalOrigin);
    const publicLink = new URL(publicUrl);
    if (
      portal.username ||
      portal.password ||
      portal.pathname !== "/" ||
      portal.search ||
      portal.hash ||
      !["https:", "http:"].includes(portal.protocol) ||
      publicTransferShareUrl(
        publicLink.origin,
        publicLink.pathname.slice(3),
        publicLink.searchParams.get("t") ?? "",
      ) !== publicUrl
    )
      return null;
    const target = new URL("/save/sharemeatsack", portal);
    target.hash = `url=${encodeURIComponent(publicUrl)}`;
    return target.href;
  } catch {
    return null;
  }
}

export function shareLinkAvailable(link: PublicShareLink, now = Date.now()) {
  try {
    const url = new URL(link.url);
    const canonical = publicTransferShareUrl(
      url.origin,
      url.pathname.slice(3),
      url.searchParams.get("t") ?? "",
    );
    return (
      canonical === link.url &&
      Number.isFinite(Date.parse(link.expiresAt)) &&
      Date.parse(link.expiresAt) > now
    );
  } catch {
    return false;
  }
}

export async function copyPublicLink(
  link: PublicShareLink,
  clipboard?: { writeText: (text: string) => Promise<void> },
  now: () => number = Date.now,
): Promise<"copied" | "unsupported" | "failed" | "unavailable"> {
  if (!shareLinkAvailable(link, now())) return "unavailable";
  if (!clipboard) return "unsupported";
  try {
    await clipboard.writeText(link.url);
    return shareLinkAvailable(link, now()) ? "copied" : "unavailable";
  } catch {
    return shareLinkAvailable(link, now()) ? "failed" : "unavailable";
  }
}

type DeviceShare = {
  share: (data: { title: string; url: string }) => Promise<void>;
  canShare?: (data: { title: string; url: string }) => boolean;
};

/** Invoke immediately from the click handler to retain the browser's user activation. */
export async function sharePublicLink(
  link: PublicShareLink,
  device?: DeviceShare,
  now: () => number = Date.now,
): Promise<"completed" | "cancelled" | "unsupported" | "failed" | "unavailable"> {
  if (!shareLinkAvailable(link, now())) return "unavailable";
  if (!device) return "unsupported";
  const data = { title: link.title, url: link.url };
  try {
    if (device.canShare && !device.canShare(data)) return "unsupported";
    await device.share(data);
    return shareLinkAvailable(link, now()) ? "completed" : "unavailable";
  } catch (error) {
    if (!shareLinkAvailable(link, now())) return "unavailable";
    return typeof error === "object" &&
      error !== null &&
      "name" in error &&
      error.name === "AbortError"
      ? "cancelled"
      : "failed";
  }
}

export function publicEmailLink(link: PublicShareLink, now = Date.now()) {
  if (!shareLinkAvailable(link, now)) return null;
  const query = new URLSearchParams({ subject: link.title, body: `Files for you: ${link.url}` });
  return `mailto:?${query}`;
}
