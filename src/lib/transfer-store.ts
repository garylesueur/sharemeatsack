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
  compareAndSave(updates: TransferUpdate[]): Promise<boolean>;
  getById(id: string): Promise<Transfer | null>;
  delete(id: string): Promise<void>;
  indexScan(handle: string, pointer: ScanPointer): Promise<void>;
  lookupScan(handle: string): Promise<ScanPointer | null>;
};

export type TransferUpdate = { before: Transfer; after: Transfer };

function checkUpdateIds(updates: TransferUpdate[]): void {
  if (
    updates.length === 0 ||
    new Set(updates.map(({ before }) => before.id)).size !== updates.length ||
    updates.some(({ before, after }) => before.id !== after.id)
  ) {
    throw new Error("Transfer updates must have distinct, unchanged ids");
  }
}

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
    async compareAndSave(updates) {
      checkUpdateIds(updates);
      if (
        updates.some(
          ({ before }) => JSON.stringify(transfers.get(before.id)) !== JSON.stringify(before),
        )
      ) {
        return false;
      }
      // No await between checking and writing: the pair changes together.
      for (const { after } of updates) {
        transfers.set(after.id, after);
        for (const file of after.files ?? []) {
          if (file.scanHandle) {
            scans.set(file.scanHandle, { transferId: after.id, fileId: file.id });
          }
        }
      }
      return true;
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
  eval: (script: string, keys: string[], args: string[]) => Promise<unknown>;
};

// Compare decoded JSON so Redis serialization and property order do not affect
// the check. All comparisons finish before any record or scan pointer changes.
const COMPARE_AND_SAVE = `
local function equal(a, b)
  if type(a) ~= type(b) then return false end
  if type(a) ~= 'table' then return a == b end
  for k, v in pairs(a) do
    if not equal(v, b[k]) then return false end
  end
  for k, _ in pairs(b) do
    if a[k] == nil then return false end
  end
  return true
end
local updates = cjson.decode(ARGV[1])
for i, update in ipairs(updates) do
  local current = redis.call('GET', KEYS[i])
  if not current or not equal(cjson.decode(current), cjson.decode(update.before)) then
    return 0
  end
end
for i, update in ipairs(updates) do
  redis.call('SET', KEYS[i], update.after, 'EX', update.ttl)
end
local pointers = cjson.decode(ARGV[2])
for i, pointer in ipairs(pointers) do
  redis.call('SET', KEYS[#updates + i], pointer, 'EX', ARGV[3])
end
return 1
`;

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
    async compareAndSave(updates) {
      checkUpdateIds(updates);
      const pointers = updates.flatMap(({ after }) =>
        (after.files ?? []).flatMap((file) =>
          file.scanHandle
            ? [{ handle: file.scanHandle, transferId: after.id, fileId: file.id }]
            : [],
        ),
      );
      const result = await kv.eval(
        COMPARE_AND_SAVE,
        [
          ...updates.map(({ before }) => transferKey(before.id)),
          ...pointers.map(({ handle }) => scanKey(handle)),
        ],
        [
          JSON.stringify(
            updates.map(({ before, after }) => ({
              before: JSON.stringify(before),
              after: JSON.stringify(after),
              ttl: redisTtlSeconds(after, now().getTime()),
            })),
          ),
          JSON.stringify(
            pointers.map(({ transferId, fileId }) => JSON.stringify({ transferId, fileId })),
          ),
          String(SCAN_INDEX_TTL_SECONDS),
        ],
      );
      return result === 1;
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
