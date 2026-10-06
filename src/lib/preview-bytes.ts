export class StorageReadError extends Error {
  constructor(public status: number) {
    super("The file could not be loaded from storage.");
  }
}

// Even when storage ignores Range, stop consuming at the cap. Each read has a
// no-progress timeout; an active stream does not have a total-duration timeout.
export async function readPreviewBytes(
  url: string,
  cap: number,
  signal: AbortSignal,
  stopAfter?: (chunk: Uint8Array) => number | undefined,
) {
  const headersTimeout = new AbortController();
  const timer = setTimeout(
    () => headersTimeout.abort(new Error("Storage did not respond. Try again.")),
    30_000,
  );
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.any([signal, headersTimeout.signal]),
      headers: { Range: `bytes=0-${cap - 1}` },
    });
  } finally {
    clearTimeout(timer);
  }
  // A range cannot overlap a zero-byte object. Only an explicit empty-object
  // response is readable; other unsatisfiable ranges remain storage errors.
  if (response.status === 416 && response.headers.get("content-range") === "bytes */0") {
    await response.body?.cancel().catch(() => {});
    return new Uint8Array();
  }
  if (!response.ok) throw new StorageReadError(response.status);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The file has no readable content.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (length < cap) {
      let progressTimer: ReturnType<typeof setTimeout> | undefined;
      const next = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          progressTimer = setTimeout(
            () => reject(new Error("Loading stopped making progress. Try again.")),
            30_000,
          );
        }),
      ]).finally(() => clearTimeout(progressTimer));
      if (next.done) break;
      let chunk = next.value.subarray(0, cap - length);
      const stop = stopAfter?.(chunk);
      if (stop !== undefined) chunk = chunk.subarray(0, stop);
      chunks.push(chunk);
      length += chunk.length;
      if (stop !== undefined) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

let runningImages = 0;
const imageWaiters: Array<() => void> = [];
export async function imageSlot<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  // Queued cancellations occupy no network slot and are skipped when released.
  await new Promise<void>((resolve, reject) => {
    const start = () => {
      if (signal.aborted) {
        reject(signal.reason);
        release();
        return;
      }
      resolve();
    };
    if (runningImages < 4) {
      runningImages++;
      start();
    } else imageWaiters.push(start);
  });
  try {
    return await work();
  } finally {
    release();
  }
}
function release() {
  const next = imageWaiters.shift();
  if (next) next();
  else runningImages--;
}
export function shouldRenew(error: unknown, expiresAt: string) {
  return (
    Date.parse(expiresAt) <= Date.now() ||
    (error instanceof StorageReadError && [401, 403].includes(error.status))
  );
}
