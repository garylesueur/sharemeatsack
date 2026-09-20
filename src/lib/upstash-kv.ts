import { Redis } from "@upstash/redis";
import type { KvClient } from "./transfer-store";

function readRedisCredentials(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    return null;
  }
  return { url, token };
}

export function createUpstashRedisFromEnv(): Redis | null {
  const credentials = readRedisCredentials();
  return credentials ? new Redis(credentials) : null;
}

export function createUpstashKvFromEnv(): KvClient | null {
  return createUpstashRedisFromEnv();
}
