import { createHmac } from "node:crypto";
import { boundedClaimBytes } from "./claim-body";
import type { LibraryMetadata } from "./library-metadata";

export class OwnedTransferError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}

/** Product-server storage authority. This never exposes the Convex service key. */
export function createOwnedTransferMetadata(
  input: {
    origin?: string;
    secret?: string;
    fetch?: typeof globalThis.fetch;
    now?: () => Date;
  } = {},
): LibraryMetadata {
  const fetcher = input.fetch ?? globalThis.fetch;
  return {
    async call(operation, args) {
      const origin = input.origin ?? process.env.LANYARD_URL;
      const secret = input.secret ?? process.env.CLEANROOM_WEBHOOK_SECRET;
      if (!origin || !secret) throw new OwnedTransferError("unavailable", 503);
      const target = new URL("/api/v1/transfers/store", origin);
      if (target.username || target.password || !["https:", "http:"].includes(target.protocol))
        throw new OwnedTransferError("unavailable", 503);
      const payload = JSON.stringify({ ...args, operation });
      const seconds = Math.floor((input.now?.() ?? new Date()).getTime() / 1000);
      const signature = createHmac("sha256", secret)
        .update(`${seconds}.sharemeatsack-account-store.${payload}`)
        .digest("hex");
      const response = await fetcher(target, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "transfer-store-signature": `t=${seconds},v1=${signature}`,
        },
        body: payload,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      let result: unknown;
      if (
        [
          "claimTransfer",
          "getClaim",
          "beginClaimFiles",
          "getClaimAttempt",
          "beginClaimCopy",
          "finishClaimCopy",
          "beginClaimScan",
          "registerClaimScan",
          "claimScanResult",
          "commitClaimFiles",
          "abortClaimFiles",
          "lookupClaimScan",
        ].includes(operation)
      ) {
        if (!response.body) throw new OwnedTransferError("unavailable", 503);
        result = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            await boundedClaimBytes(response.body, 512_000),
          ),
        );
      } else result = await response.json();
      if (!response.ok) {
        const code =
          result &&
          typeof result === "object" &&
          "error" in result &&
          typeof result.error === "string"
            ? result.error
            : "unavailable";
        throw new OwnedTransferError(code, response.status);
      }
      return result;
    },
  };
}
