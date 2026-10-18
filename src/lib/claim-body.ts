/* eslint-disable no-await-in-loop -- Bounded streaming bodies must be read sequentially. */
/** Consume the complete private response or refuse it; never truncate proof/receipt data. */
export async function boundedClaimBytes(
  body: ReadableStream<Uint8Array>,
  limit: number,
  timeoutMs = 15_000,
) {
  if (!Number.isSafeInteger(limit) || limit < 0 || !Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error("Invalid private body bound.");
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Private claim body timed out.")), timeoutMs);
  });
  try {
    while (true) {
      const part = await Promise.race([reader.read(), deadline]);
      if (part.done) {
        finished = true;
        break;
      }
      size += part.value.byteLength;
      if (size > limit) throw new Error("Private claim body exceeds its bound.");
      chunks.push(part.value);
    }
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(timer);
    // A provider's cancellation acknowledgement must not extend the read deadline.
    if (!finished) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
