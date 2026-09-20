import {
  createHttpCleanroom,
  createMemoryCleanroom,
  readCleanroomConfig,
  type Cleanroom,
} from "./cleanroom";
import { createMemoryObjectStore, objectStoreFromEnv, type ObjectStore } from "./object-store";
import {
  createMemoryTransferStore,
  createRedisTransferStore,
  type TransferStore,
} from "./transfer-store";
import { createUpstashKvFromEnv } from "./upstash-kv";
import {
  createTransferService,
  defaultTransferServiceDeps,
  type TransferServiceError,
} from "./transfers";

const globalForTransfers = globalThis as typeof globalThis & {
  sharemeatsackStore?: TransferStore;
  sharemeatsackObjectStore?: ObjectStore | null;
  sharemeatsackCleanroom?: Cleanroom | null;
};

export function getDefaultStore(): TransferStore {
  if (globalForTransfers.sharemeatsackStore) {
    return globalForTransfers.sharemeatsackStore;
  }
  const kv = createUpstashKvFromEnv();
  globalForTransfers.sharemeatsackStore = kv
    ? createRedisTransferStore(kv)
    : createMemoryTransferStore();
  return globalForTransfers.sharemeatsackStore;
}

export function getDefaultObjectStore(): ObjectStore | null {
  if (globalForTransfers.sharemeatsackObjectStore !== undefined) {
    return globalForTransfers.sharemeatsackObjectStore;
  }
  const fromEnv = objectStoreFromEnv();
  if (fromEnv) {
    globalForTransfers.sharemeatsackObjectStore = fromEnv;
    return fromEnv;
  }
  if (process.env.NODE_ENV !== "production") {
    globalForTransfers.sharemeatsackObjectStore = createMemoryObjectStore();
    return globalForTransfers.sharemeatsackObjectStore;
  }
  globalForTransfers.sharemeatsackObjectStore = null;
  return null;
}

export function getDefaultCleanroom(): Cleanroom | null {
  if (globalForTransfers.sharemeatsackCleanroom !== undefined) {
    return globalForTransfers.sharemeatsackCleanroom;
  }
  const config = readCleanroomConfig();
  if (config) {
    globalForTransfers.sharemeatsackCleanroom = createHttpCleanroom(config);
    return globalForTransfers.sharemeatsackCleanroom;
  }
  if (process.env.NODE_ENV !== "production") {
    globalForTransfers.sharemeatsackCleanroom = createMemoryCleanroom();
    return globalForTransfers.sharemeatsackCleanroom;
  }
  globalForTransfers.sharemeatsackCleanroom = null;
  return null;
}

export function getDefaultTransferService() {
  return createTransferService(
    defaultTransferServiceDeps(getDefaultStore(), getDefaultObjectStore(), getDefaultCleanroom()),
  );
}

export function installTestTransferStore(store: TransferStore): void {
  globalForTransfers.sharemeatsackStore = store;
}

export function installTestObjectStore(store: ObjectStore | null): void {
  globalForTransfers.sharemeatsackObjectStore = store;
}

export function apiErrorBody(error: {
  code: string;
  message: string;
  issues?: TransferServiceError["issues"];
}): { error: { code: string; message: string; issues?: TransferServiceError["issues"] } } {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.issues && error.issues.length > 0 ? { issues: error.issues } : {}),
    },
  };
}

export function jsonError(
  status: number,
  code: string,
  message: string,
  issues?: TransferServiceError["issues"],
): Response {
  return Response.json(apiErrorBody({ code, message, issues }), { status });
}

export function jsonServiceError(error: TransferServiceError): Response {
  return jsonError(error.status, error.code, error.message, error.issues);
}

export function readTransferToken(request: Request): string | undefined {
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get("token") ?? url.searchParams.get("t") ?? undefined;
  if (fromQuery) {
    return fromQuery;
  }
  const header = request.headers.get("authorization");
  if (header?.startsWith("Bearer ")) {
    return header.slice("Bearer ".length) || undefined;
  }
  return undefined;
}
