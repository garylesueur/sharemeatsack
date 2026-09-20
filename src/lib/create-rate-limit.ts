import { clientIpFromRequest } from "./client-ip";
import {
  createMemoryCounterStore,
  createRedisCounterStore,
  type CounterStore,
} from "./counter-store";
import { createUpstashRedisFromEnv } from "./upstash-kv";

export const CREATE_RATE_LIMIT_MAX = 30;
export const CREATE_RATE_LIMIT_WINDOW_SECONDS = 60 * 60;

export type CreateRateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

export type CreateRateLimiter = {
  hit(clientKey: string): Promise<CreateRateLimitResult>;
};

export function createCreateRateLimiter(deps: {
  store: CounterStore;
  max?: number;
  windowSeconds?: number;
}): CreateRateLimiter {
  const max = deps.max ?? CREATE_RATE_LIMIT_MAX;
  const windowSeconds = deps.windowSeconds ?? CREATE_RATE_LIMIT_WINDOW_SECONDS;
  return {
    async hit(clientKey: string): Promise<CreateRateLimitResult> {
      const key = `sharemeatsack:ratelimit:create:${clientKey}`;
      const count = await deps.store.increment(key, windowSeconds);
      if (count <= max) {
        return { ok: true };
      }
      const retryAfterSeconds = await deps.store.ttlSeconds(key);
      return {
        ok: false,
        retryAfterSeconds: retryAfterSeconds > 0 ? retryAfterSeconds : windowSeconds,
      };
    },
  };
}

const globalForLimit = globalThis as typeof globalThis & {
  sharemeatsackCreateRateLimiter?: CreateRateLimiter;
};

export function getCreateRateLimiter(): CreateRateLimiter {
  if (globalForLimit.sharemeatsackCreateRateLimiter) {
    return globalForLimit.sharemeatsackCreateRateLimiter;
  }
  const redis = createUpstashRedisFromEnv();
  const limiter = createCreateRateLimiter({
    store: redis ? createRedisCounterStore(redis) : createMemoryCounterStore(),
  });
  if (process.env.NODE_ENV !== "production") {
    globalForLimit.sharemeatsackCreateRateLimiter = limiter;
  }
  return limiter;
}

export async function limitCreateFromRequest(
  request: Request,
  limiter: CreateRateLimiter = getCreateRateLimiter(),
): Promise<CreateRateLimitResult> {
  return limiter.hit(clientIpFromRequest(request));
}
