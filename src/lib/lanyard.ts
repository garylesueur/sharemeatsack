import { createTokenVerifier } from "./product-verifier";

/** The product key lanyard knows this service by. */
export const LANYARD_PRODUCT = "sharemeatsack";

/**
 * Who is creating a transfer.
 *
 * Anonymous is the normal case and never touches lanyard. A lanyard token is
 * only looked at when the caller sends one and LANYARD_URL is set.
 */
export type Caller =
  | { readonly kind: "anonymous" }
  | { readonly kind: "account"; readonly account: string }
  | { readonly kind: "refused" };

type Verify = ReturnType<typeof createTokenVerifier>;

const globalForLanyard = globalThis as typeof globalThis & {
  sharemeatsackLanyard?: { url: string; verify: Verify };
};

/** The lanyard origin, or undefined when sign-in is switched off. */
export function lanyardUrl(): string | undefined {
  const value = process.env.LANYARD_URL?.trim().replace(/\/+$/, "");
  return value ? value : undefined;
}

/** Where the family navigation's "Sign in" goes. Hidden when lanyard is not configured. */
export function lanyardSignInHref(): string | undefined {
  const url = lanyardUrl();
  return url ? `${url}/sign-in?product=${LANYARD_PRODUCT}` : undefined;
}

function verifierFor(url: string): Verify {
  const existing = globalForLanyard.sharemeatsackLanyard;
  if (existing && existing.url === url) {
    return existing.verify;
  }
  // One verifier per process so its grace cache survives between requests.
  const verify = createTokenVerifier({ lanyardUrl: url, product: LANYARD_PRODUCT });
  globalForLanyard.sharemeatsackLanyard = { url, verify };
  return verify;
}

/** Tests only: forget the verifier so the next call picks up a fresh fetch and cache. */
export function resetLanyardVerifier(): void {
  globalForLanyard.sharemeatsackLanyard = undefined;
}

/**
 * Identify the caller of a create from its Authorization header.
 *
 * No Bearer token, or no LANYARD_URL, is anonymous — exactly as before lanyard.
 */
export async function identifyCaller(authorization: string | null | undefined): Promise<Caller> {
  const url = lanyardUrl();
  if (!url || !authorization?.startsWith("Bearer ")) {
    return { kind: "anonymous" };
  }
  const token = authorization.slice("Bearer ".length);
  if (!token) {
    return { kind: "anonymous" };
  }
  const outcome = await verifierFor(url)(token);
  return outcome.outcome === "accepted"
    ? { kind: "account", account: outcome.account }
    : { kind: "refused" };
}

export const UNAUTHORIZED = {
  code: "unauthorized",
  message:
    "That sign-in token was not accepted. Sign in again, or create the transfer without a token.",
  status: 401,
} as const;
