import { getDefaultCleanroom, getDefaultObjectStore } from "./app-transfers";
import { createHttpCleanroom, readCleanroomConfig } from "./cleanroom";
import { createOwnedTransferMetadata } from "./owned-transfer-metadata";
import { publicOrigin } from "./public-origin";
import { scanCallbackOrigin } from "./scan-callback-origin";
import { createTransferFileClaimWorker } from "./transfer-claim-files";

export function getTransferFileClaimPorts() {
  const metadata = createOwnedTransferMetadata();
  const config = readCleanroomConfig();
  // Claim processing has a bounded provider round trip; normal transfer behaviour is unchanged.
  const scanner = config
    ? createHttpCleanroom(config, (input, init) =>
        fetch(input, {
          ...init,
          signal: AbortSignal.timeout(15_000),
          redirect: "error",
        }),
      )
    : getDefaultCleanroom();
  const worker = createTransferFileClaimWorker({
    metadata,
    objects: getDefaultObjectStore(),
    scanner,
    baseUrl: publicOrigin(),
    callbackUrl: `${scanCallbackOrigin()}/api/v1/claims/scan-result`,
  });
  return { metadata, scanner, process: worker.process };
}
