import { createHash } from "node:crypto";
import { TRANSFER_READ_WINDOW_SECONDS } from "./schema";
import type { TransferKind, TransferStatus } from "./schema";

export type TransferFile = {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  key?: string;
  libraryFileId?: string;
  uploadExpiresAt?: string;
  receivedAt?: string;
  retainedUntil?: string;
  state: "pending" | "accepted";
  scanStatus?: string;
  scanHandle?: string;
  scanSignature?: string;
  scanReason?: string;
};

export type Transfer = {
  id: string;
  ownerAccountId?: string;
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

export type TransferClaimInspection = "none" | "pending" | "committed" | "foreign";
export type TransferStore = {
  /** Trusted opaque source-fence inspection, never a public record lookup. */
  inspectClaim?(id: string, accountId: string, attemptId: string): Promise<TransferClaimInspection>;
  save(transfer: Transfer): Promise<void>;
  /** Trusted claim coordinator only. Freezes one live anonymous source after private-proof verification. */
  beginClaim?(
    id: string,
    accountId: string,
    attemptId: string,
    privateProof: string,
  ): Promise<{ snapshot: string } | null>;
  /** Never unlock on timeout: query the definitive durable attempt before choosing an outcome. */
  resolveClaim?(
    id: string,
    accountId: string,
    attemptId: string,
    outcome: "aborted" | "committed",
  ): Promise<boolean>;
  compareAndSave(updates: TransferUpdate[]): Promise<boolean>;
  getById(id: string): Promise<Transfer | null>;
  /** Current file authority; null retains only legacy storage rules. */
  fileAccess?(id: string): Promise<string[] | null>;
  /** Available independent library copies, for the verified owner only. */
  keptFiles?(account: string, id: string): Promise<Record<string, string>>;
  delete(id: string): Promise<void>;
  listByOwner(account: string, page: OwnerPage): Promise<OwnerTransferPage>;
  indexScan(handle: string, pointer: ScanPointer): Promise<void>;
  lookupScan(handle: string): Promise<ScanPointer | null>;
};

export type OwnerPage = { limit: number; cursor?: string; kind?: TransferKind };
export type OwnerTransferPage = { records: Transfer[]; nextCursor?: string };

function ownerMember(transfer: Transfer): string {
  return `${transfer.createdAt}|${transfer.id}`;
}

function ownerKey(account: string): string {
  return `sharemeatsack:owner:${encodeURIComponent(account)}`;
}

function checkPage(page: OwnerPage): void {
  if (
    !Number.isInteger(page.limit) ||
    page.limit < 1 ||
    page.limit > 100 ||
    (page.cursor !== undefined &&
      (page.cursor.length > 256 || !/^[0-9TZ:.+-]+\|[A-Za-z0-9_-]+$/.test(page.cursor)))
  ) {
    throw new Error("Invalid owner pagination");
  }
}

function checkOwnership(before: Transfer | undefined, after: Transfer): void {
  if (before && before.ownerAccountId !== after.ownerAccountId) {
    throw new Error("Transfer ownership is immutable");
  }
}

export type TransferUpdate = { before: Transfer; after: Transfer };

function checkUpdateIds(updates: TransferUpdate[]): void {
  if (
    updates.length === 0 ||
    new Set(updates.map(({ before }) => before.id)).size !== updates.length ||
    updates.some(({ before, after }) => before.id !== after.id)
  ) {
    throw new Error("Transfer updates must have distinct, unchanged ids");
  }
  for (const { before, after } of updates) checkOwnership(before, after);
}

type ClaimFence =
  | { state: "pending"; binding: string; snapshot: string }
  | { state: "committed"; binding: string };

function claimBinding(accountId: string, attemptId: string): string {
  return createHash("sha256")
    .update(JSON.stringify([accountId, attemptId]))
    .digest("hex");
}

function validClaimInput(accountId: string, attemptId: string, privateProof?: string): boolean {
  return (
    accountId.length > 0 &&
    accountId.length <= 256 &&
    attemptId.length > 0 &&
    attemptId.length <= 256 &&
    (privateProof === undefined || (privateProof.length > 0 && privateProof.length <= 4096))
  );
}

export function createMemoryTransferStore(): TransferStore {
  const transfers = new Map<string, Transfer>();
  const scans = new Map<string, ScanPointer>();
  const claims = new Map<string, ClaimFence>();
  const aborted = new Set<string>();
  const owners = new Map<string, Map<string, string>>();
  function write(transfer: Transfer) {
    transfers.set(transfer.id, transfer);
    if (transfer.ownerAccountId) {
      let index = owners.get(transfer.ownerAccountId);
      if (!index) {
        index = new Map();
        owners.set(transfer.ownerAccountId, index);
      }
      index.set(ownerMember(transfer), transfer.id);
    }
  }
  return {
    async save(transfer: Transfer): Promise<void> {
      if (claims.has(transfer.id)) throw new Error("Transfer claim is fenced");
      checkOwnership(transfers.get(transfer.id), transfer);
      write(transfer);
    },
    async beginClaim(id, accountId, attemptId, privateProof) {
      if (!id || id.length > 128 || !validClaimInput(accountId, attemptId, privateProof))
        return null;
      const binding = claimBinding(accountId, attemptId);
      if (aborted.has(`${id}:${binding}`)) return null;
      const fence = claims.get(id);
      if (fence) {
        if (fence.state !== "pending" || fence.binding !== binding) return null;
        const original: Transfer = JSON.parse(fence.snapshot);
        return original.agentToken === privateProof ? { snapshot: fence.snapshot } : null;
      }
      const transfer = transfers.get(id);
      if (
        !transfer ||
        transfer.ownerAccountId !== undefined ||
        transfer.agentToken !== privateProof
      )
        return null;
      const snapshot = JSON.stringify(transfer);
      // Detach pre-fence readers: mutating their objects cannot change the canonical snapshot.
      transfers.set(id, JSON.parse(snapshot));
      claims.set(id, { state: "pending", binding, snapshot });
      return { snapshot };
    },
    async inspectClaim(id, accountId, attemptId) {
      if (!id || id.length > 128 || !validClaimInput(accountId, attemptId)) return "foreign";
      const fence = claims.get(id);
      return !fence
        ? "none"
        : fence.binding !== claimBinding(accountId, attemptId)
          ? "foreign"
          : fence.state;
    },
    async resolveClaim(id, accountId, attemptId, outcome) {
      if (
        !id ||
        id.length > 128 ||
        !validClaimInput(accountId, attemptId) ||
        (outcome !== "aborted" && outcome !== "committed")
      )
        return false;
      const binding = claimBinding(accountId, attemptId);
      const barrier = `${id}:${binding}`;
      const fence = claims.get(id);
      if (!fence) {
        if (outcome !== "aborted") return false;
        aborted.add(barrier);
        return true;
      }
      if (fence.binding !== binding) return false;
      if (fence.state === "committed") return outcome === "committed";
      if (outcome === "committed") {
        transfers.delete(id);
        claims.set(id, { state: "committed", binding: fence.binding });
      } else {
        transfers.set(id, JSON.parse(fence.snapshot));
        claims.delete(id);
        aborted.add(barrier);
      }
      return true;
    },
    async getById(id: string): Promise<Transfer | null> {
      const fence = claims.get(id);
      if (fence?.state === "committed") return null;
      return fence?.state === "pending" ? JSON.parse(fence.snapshot) : (transfers.get(id) ?? null);
    },
    async compareAndSave(updates) {
      checkUpdateIds(updates);
      if (
        updates.some(
          ({ before }) =>
            claims.has(before.id) ||
            JSON.stringify(transfers.get(before.id)) !== JSON.stringify(before),
        )
      ) {
        return false;
      }
      // No await between checking and writing: the pair changes together.
      for (const { after } of updates) {
        write(after);
        for (const file of after.files ?? []) {
          if (file.scanHandle) {
            scans.set(file.scanHandle, { transferId: after.id, fileId: file.id });
          }
        }
      }
      return true;
    },
    async delete(id: string): Promise<void> {
      if (claims.has(id)) throw new Error("Transfer claim is fenced");
      const transfer = transfers.get(id);
      if (transfer?.ownerAccountId)
        owners.get(transfer.ownerAccountId)?.delete(ownerMember(transfer));
      transfers.delete(id);
    },
    async listByOwner(account, page) {
      checkPage(page);
      const entries = [...(owners.get(account)?.entries() ?? [])]
        .toSorted(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
        .filter(([member]) => !page.cursor || member < page.cursor)
        .filter(([, id]) => !page.kind || transfers.get(id)?.kind === page.kind)
        .slice(0, page.limit + 1);
      const selected = entries.slice(0, page.limit);
      return {
        records: selected.flatMap(([, id]) => {
          const transfer = transfers.get(id);
          return transfer?.ownerAccountId === account ? [transfer] : [];
        }),
        ...(entries.length > page.limit ? { nextCursor: selected.at(-1)?.[0] } : {}),
      };
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
local pointers = cjson.decode(ARGV[2])
local owners = cjson.decode(ARGV[4])
for i, update in ipairs(updates) do
  if redis.call('EXISTS', KEYS[#updates + #pointers + #owners + i]) == 1 then return 0 end
  local current = redis.call('GET', KEYS[i])
  if not current or not equal(cjson.decode(current), cjson.decode(update.before)) then
    return 0
  end
end
for i, update in ipairs(updates) do
  redis.call('SET', KEYS[i], update.after, 'EX', update.ttl)
end
for i, pointer in ipairs(pointers) do
  redis.call('SET', KEYS[#updates + i], pointer, 'EX', ARGV[3])
end
for i, owner in ipairs(owners) do
  local key = KEYS[#updates + #pointers + i]
  local ttl = redis.call('TTL', key)
  redis.call('ZADD', key, 0, owner.member)
  redis.call('EXPIRE', key, math.max(ttl, owner.ttl))
end
return 1
`;

const SAVE_TRANSFER = `
if redis.call('EXISTS', KEYS[#KEYS]) == 1 then return -1 end
local existing = redis.call('GET', KEYS[1])
local after = cjson.decode(ARGV[1])
if existing then
  local before = cjson.decode(existing)
  if before.ownerAccountId ~= after.ownerAccountId then return 0 end
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
if #KEYS == 3 then
  local ttl = redis.call('TTL', KEYS[2])
  redis.call('ZADD', KEYS[2], 0, ARGV[3])
  redis.call('EXPIRE', KEYS[2], math.max(ttl, tonumber(ARGV[2])))
end
return 1
`;

// All claim state transitions and source writes use the same Redis authority.
// Pending fences have no TTL. Their original absolute metadata expiry is restored
// only after a trusted coordinator confirms durable abortion, never after a timer.
export const INSPECT_TRANSFER_CLAIM_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then return cjson.encode({state = 'none'}) end
local claim = cjson.decode(raw)
if claim.binding ~= ARGV[1] then return cjson.encode({state = 'foreign'}) end
if claim.state ~= 'pending' and claim.state ~= 'committed' then return cjson.encode({state = 'foreign'}) end
return cjson.encode({state = claim.state})
`;
function claimAbortKey(id: string, binding: string) {
  return `sharemeatsack:claim-abort:${id}:${binding}`;
}
const BEGIN_CLAIM = `
if redis.call('EXISTS', KEYS[3]) == 1 then return false end
local fence = redis.call('GET', KEYS[2])
if fence then
  local claim = cjson.decode(fence)
  if claim.state ~= 'pending' or claim.binding ~= ARGV[1] then return false end
  local original = cjson.decode(claim.snapshot)
  if original.agentToken ~= ARGV[2] then return false end
  return cjson.encode({snapshot = claim.snapshot})
end
local source = redis.call('GET', KEYS[1])
if not source then return false end
local transfer = cjson.decode(source)
if transfer.ownerAccountId ~= nil or transfer.agentToken ~= ARGV[2] then return false end
local ttl = redis.call('PTTL', KEYS[1])
local absoluteExpiry = -1
if ttl >= 0 then
  local time = redis.call('TIME')
  absoluteExpiry = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000) + ttl
end
redis.call('SET', KEYS[2], cjson.encode({state = 'pending', binding = ARGV[1], snapshot = source, absoluteExpiry = absoluteExpiry}))
redis.call('PERSIST', KEYS[1])
return cjson.encode({snapshot = source})
`;

const RESOLVE_CLAIM = `
local raw = redis.call('GET', KEYS[2])
if not raw then
  if ARGV[2] ~= 'aborted' then return 0 end
  redis.call('SET', KEYS[3], '1')
  return 1
end
local claim = cjson.decode(raw)
if claim.binding ~= ARGV[1] then return 0 end
if claim.state == 'committed' then
  if ARGV[2] == 'committed' then return 1 end
  return 0
end
if claim.state ~= 'pending' then return 0 end
if ARGV[2] == 'committed' then
  redis.call('DEL', KEYS[1])
  redis.call('SET', KEYS[2], cjson.encode({state = 'committed', binding = claim.binding}))
else
  redis.call('SET', KEYS[1], claim.snapshot)
  if claim.absoluteExpiry >= 0 then
    redis.call('PEXPIREAT', KEYS[1], claim.absoluteExpiry)
  end
  redis.call('DEL', KEYS[2])
  redis.call('SET', KEYS[3], '1')
end
return 1
`;

const READ_TRANSFER = `
local raw = redis.call('GET', KEYS[2])
if raw and cjson.decode(raw).state == 'committed' then return false end
return cjson.encode({record = redis.call('GET', KEYS[1]) or false})
`;

const DELETE_TRANSFER = `
if redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
redis.call('DEL', KEYS[1])
return 1
`;

// Fetch at most limit + 1 index members. Expired rows are omitted without an
// unbounded scan; the cursor advances over their members as well.
const LIST_OWNER = `
local members = redis.call('ZREVRANGEBYLEX', KEYS[1], ARGV[1], '-', 'LIMIT', 0, ARGV[2])
local rows = {}
for _, member in ipairs(members) do
  local id = string.match(member, '|(.+)$')
  local record = redis.call('GET', 'sharemeatsack:transfer:' .. id)
  local selected = record
  if selected and ARGV[3] ~= '' and cjson.decode(selected).kind ~= ARGV[3] then
    selected = false
  end
  table.insert(rows, {member = member, record = selected or false})
end
if #rows == 0 then return '[]' end
return cjson.encode(rows)
`;

const SCAN_INDEX_TTL_SECONDS = 30 * 86_400;

function scanKey(handle: string): string {
  return `sharemeatsack:scan:${handle}`;
}

function transferKey(id: string): string {
  return `sharemeatsack:transfer:${id}`;
}

function claimKey(id: string): string {
  return `sharemeatsack:claim:${id}`;
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
      const result = await kv.eval(
        SAVE_TRANSFER,
        [
          transferKey(transfer.id),
          ...(transfer.ownerAccountId ? [ownerKey(transfer.ownerAccountId)] : []),
          claimKey(transfer.id),
        ],
        [
          JSON.stringify(transfer),
          String(redisTtlSeconds(transfer, now().getTime())),
          ownerMember(transfer),
        ],
      );
      if (result === -1) throw new Error("Transfer claim is fenced");
      if (result !== 1) throw new Error("Transfer ownership is immutable");
    },
    async beginClaim(id, accountId, attemptId, privateProof) {
      if (!id || id.length > 128 || !validClaimInput(accountId, attemptId, privateProof))
        return null;
      const snapshot = await kv.eval(
        BEGIN_CLAIM,
        [transferKey(id), claimKey(id), claimAbortKey(id, claimBinding(accountId, attemptId))],
        [claimBinding(accountId, attemptId), privateProof],
      );
      const result = typeof snapshot === "string" ? JSON.parse(snapshot) : snapshot;
      return result &&
        typeof result === "object" &&
        "snapshot" in result &&
        typeof result.snapshot === "string"
        ? { snapshot: result.snapshot }
        : null;
    },
    async inspectClaim(id, accountId, attemptId) {
      if (!id || id.length > 128 || !validClaimInput(accountId, attemptId)) return "foreign";
      const raw = await kv.eval(
        INSPECT_TRANSFER_CLAIM_LUA,
        [claimKey(id)],
        [claimBinding(accountId, attemptId)],
      );
      const result = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (
        !result ||
        typeof result !== "object" ||
        !("state" in result) ||
        typeof result.state !== "string" ||
        !["none", "pending", "committed", "foreign"].includes(result.state)
      )
        throw new Error("Invalid claim inspection");
      return result.state as TransferClaimInspection;
    },
    async resolveClaim(id, accountId, attemptId, outcome) {
      if (
        !id ||
        id.length > 128 ||
        !validClaimInput(accountId, attemptId) ||
        (outcome !== "aborted" && outcome !== "committed")
      )
        return false;
      return (
        (await kv.eval(
          RESOLVE_CLAIM,
          [transferKey(id), claimKey(id), claimAbortKey(id, claimBinding(accountId, attemptId))],
          [claimBinding(accountId, attemptId), outcome],
        )) === 1
      );
    },
    async getById(id: string): Promise<Transfer | null> {
      const raw = await kv.eval(READ_TRANSFER, [transferKey(id), claimKey(id)], []);
      const result = typeof raw === "string" ? JSON.parse(raw) : raw;
      return result &&
        typeof result === "object" &&
        "record" in result &&
        typeof result.record === "string"
        ? JSON.parse(result.record)
        : null;
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
      const ownerIndexes = updates.flatMap(({ after }) =>
        after.ownerAccountId
          ? [
              {
                account: after.ownerAccountId,
                member: ownerMember(after),
                ttl: redisTtlSeconds(after, now().getTime()),
              },
            ]
          : [],
      );
      const result = await kv.eval(
        COMPARE_AND_SAVE,
        [
          ...updates.map(({ before }) => transferKey(before.id)),
          ...pointers.map(({ handle }) => scanKey(handle)),
          ...ownerIndexes.map(({ account }) => ownerKey(account)),
          ...updates.map(({ before }) => claimKey(before.id)),
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
          JSON.stringify(ownerIndexes.map(({ member, ttl }) => ({ member, ttl }))),
        ],
      );
      return result === 1;
    },
    async delete(id: string): Promise<void> {
      const result = await kv.eval(DELETE_TRANSFER, [transferKey(id), claimKey(id)], []);
      if (result !== 1) throw new Error("Transfer claim is fenced");
    },
    async listByOwner(account, page) {
      checkPage(page);
      const raw = await kv.eval(
        LIST_OWNER,
        [ownerKey(account)],
        [page.cursor ? `(${page.cursor}` : "+", String(page.limit + 1), page.kind ?? ""],
      );
      const rows: { member: string; record: string | false }[] =
        typeof raw === "string"
          ? JSON.parse(raw)
          : (raw as { member: string; record: string | false }[]);
      const selected = rows.slice(0, page.limit);
      return {
        records: selected.flatMap(({ record }) => {
          if (!record) return [];
          const transfer: Transfer = JSON.parse(record);
          return transfer.ownerAccountId === account ? [transfer] : [];
        }),
        ...(rows.length > page.limit ? { nextCursor: selected.at(-1)?.member } : {}),
      };
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
