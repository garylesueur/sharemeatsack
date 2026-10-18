import { afterEach, expect, it, vi } from "vitest";
import { boundedClaimBytes } from "./claim-body";

afterEach(() => vi.useRealTimers());

it("reads the complete private body at its exact byte ceiling", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2]));
      controller.enqueue(new Uint8Array([3]));
      controller.close();
    },
  });
  expect(await boundedClaimBytes(body, 3)).toEqual(Buffer.from([1, 2, 3]));
  expect(body.locked).toBe(false);
});

it("refuses oversized proof data and cancels without waiting for a hanging provider", async () => {
  const cancel = vi.fn(() => new Promise<void>(() => {}));
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2]));
    },
    cancel,
  });
  await expect(boundedClaimBytes(body, 1)).rejects.toThrow("exceeds its bound");
  expect(cancel).toHaveBeenCalledOnce();
  expect(body.locked).toBe(false);
});

it("ends an incomplete private body at the deadline and releases its reader", async () => {
  vi.useFakeTimers();
  const cancel = vi.fn(() => new Promise<void>(() => {}));
  const body = new ReadableStream<Uint8Array>({ cancel });
  const result = expect(boundedClaimBytes(body, 4096, 100)).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(100);
  await result;
  expect(cancel).toHaveBeenCalledOnce();
  expect(body.locked).toBe(false);
});
