import { TRANSFER_READ_WINDOW_SECONDS } from "./schema";
import type { TransferKind, TransferStatus } from "./schema";

export type TransferFile = {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  key?: string;
  state: "pending" | "accepted";
  scanStatus?: string;
  scanHandle?: string;
  scanSignature?: string;
  scanReason?: string;
};

export type Transfer = {
  id: string;
  kind: TransferKind;
  createdAt: string;
  expiresAt: string;
  cancelledAt?: string;
  completedAt?: string;
  status: TransferStatus;
  title: string;
  message?: string;
  publicToken: string;
  agentToken: string;
  metadata?: Record<string, string>;
  callbackUrl?: string;
  callbackSent?: boolean;
  maxFiles?: number;
  maxFileSize?: number;
  allowedTypes?: string[];
  files?: TransferFile[];
};

export type ScanPointer = {
  transferId: string;
  fileId: string;
};

export type TransferStore = {
  save(transfer: Transfer): Promise<void>;
  getById(id: string): Promise<Transfer | null>;
  delete(id: string): Promise<void>;
  indexScan(handle: string, pointer: ScanPointer): Promise<void>;
  lookupScan(handle: string): Promise<ScanPointer | null>;
};

export function createMemoryTransferStore(): TransferStore {
  const transfers = new Map<string, Transfer>();
  const scans = new Map<string, ScanPointer>();
  return {
    async save(transfer: Transfer): Promise<void> {
      transfers.set(transfer.id, transfer);
    },
    async getById(id: string): Promise<Transfer | null> {
      return transfers.get(id) ?? null;
    },
    async delete(id: string): Promise<void> {
      transfers.delete(id);
    },
    async indexScan(handle: string, pointer: ScanPointer): Promise<void> {
      scans.set(handle, pointer);
    },
    async lookupScan(handle: string): Promise<ScanPointer | null> {
      return scans.get(handle) ?? null;
    },
  };
}

export type KvClient = {
  get: <T>(key: string) => Promise<T | null>;
  set: (key: string, value: unknown, opts: { ex: number }) => Promise<unknown>;
  del: (key: string) => Promise<unknown>;
};

const SCAN_INDEX_TTL_SECONDS = 30 * 86_400;

function scanKey(handle: string): string {
  return `sharemeatsack:scan:${handle}`;
}

function transferKey(id: string): string {
  return `sharemeatsack:transfer:${id}`;
}

function redisTtlSeconds(transfer: Transfer, nowMs: number): number {
  const ends = [Date.parse(transfer.expiresAt) + TRANSFER_READ_WINDOW_SECONDS * 1000];
  if (transfer.completedAt) {
    ends.push(Date.parse(transfer.completedAt) + TRANSFER_READ_WINDOW_SECONDS * 1000);
  }
  if (transfer.cancelledAt) {
    ends.push(Date.parse(transfer.cancelledAt) + TRANSFER_READ_WINDOW_SECONDS * 1000);
  }
  const until = Math.max(...ends);
  return Math.max(1, Math.ceil((until - nowMs) / 1000));
}

export function createRedisTransferStore(
  kv: KvClient,
  now: () => Date = () => new Date(),
): TransferStore {
  return {
    async save(transfer: Transfer): Promise<void> {
      await kv.set(transferKey(transfer.id), transfer, {
        ex: redisTtlSeconds(transfer, now().getTime()),
      });
    },
    async getById(id: string): Promise<Transfer | null> {
      const transfer = await kv.get<Transfer>(transferKey(id));
      return transfer ?? null;
    },
    async delete(id: string): Promise<void> {
      await kv.del(transferKey(id));
    },
    async indexScan(handle: string, pointer: ScanPointer): Promise<void> {
      await kv.set(scanKey(handle), pointer, { ex: SCAN_INDEX_TTL_SECONDS });
    },
    async lookupScan(handle: string): Promise<ScanPointer | null> {
      const pointer = await kv.get<ScanPointer>(scanKey(handle));
      return pointer ?? null;
    },
  };
}
