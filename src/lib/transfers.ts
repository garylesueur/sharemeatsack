import {
  createMemoryCleanroom,
  isTakeableScan,
  isTerminalScan,
  SCAN_LINK_TTL_SECONDS,
  scanStatusFromVerdict,
  type Cleanroom,
  type CleanroomVerdict,
} from "./cleanroom";
import { randomUUID } from "node:crypto";
import { manageMarkdown } from "./manage-markdown";
import {
  fileObjectKey,
  UPLOAD_URL_TTL_SECONDS,
  DOWNLOAD_URL_TTL_SECONDS,
  type ObjectStore,
} from "./object-store";
import type { LibraryMetadata } from "./library-metadata";
import { OwnedTransferError } from "./owned-transfer-metadata";
import { publicOrigin } from "./public-origin";
import { scanCallbackOrigin } from "./scan-callback-origin";
import {
  FILE_MAX_BYTES,
  FILE_MAX_COUNT,
  SCAN_SIZE_CAP_BYTES,
  TRANSFER_DEFAULT_TTL_SECONDS,
  TRANSFER_MAX_BYTES,
  WAIT_BUDGET_SECONDS,
  WAIT_MAX_SECONDS,
  registerFilesSchema,
  requestCreateSchema,
  sendCreateSchema,
  mergeTransfersSchema,
  waitSchema,
  type TransferStatus,
} from "./schema";
import { createId, createToken, tokensMatch } from "./tokens";
import type { OwnerPage, Transfer, TransferFile, TransferStore } from "./transfer-store";

const WAIT_POLL_MS = 400;

function retainedFileAvailable(file: TransferFile, now: Date) {
  return file.retainedUntil === undefined || Date.parse(file.retainedUntil) > now.getTime();
}
function readLifetime(file: TransferFile, now: Date, publicExpiresAt?: string) {
  const deadlines = [now.getTime() + DOWNLOAD_URL_TTL_SECONDS * 1000];
  if (file.retainedUntil) deadlines.push(Date.parse(file.retainedUntil));
  if (publicExpiresAt) deadlines.push(Date.parse(publicExpiresAt));
  return Math.max(1, Math.floor((Math.min(...deadlines) - now.getTime()) / 1000));
}
function ownedUploadKey(transferId: string, fileId: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(transferId) || !/^[A-Za-z0-9_-]{1,128}$/.test(fileId))
    throw new OwnedTransferError("invalid_file", 400);
  return `sharemeatsack/owned/${transferId}/${fileId}/upload`;
}
function ownedStoreError(error: unknown): TransferServiceError {
  if (error instanceof OwnedTransferError)
    return {
      code: error.code,
      status: error.status,
      message:
        error.code === "storage_allowance"
          ? "The storage allowance is full"
          : "The transfer could not be updated",
    };
  return { code: "unavailable", status: 503, message: "Transfer storage is unavailable" };
}

const TERMINAL: TransferStatus[] = ["complete", "ready", "expired", "cancelled"];

function isTerminalStatus(status: TransferStatus): boolean {
  return TERMINAL.includes(status);
}

export type TransferServiceError = {
  code: string;
  message: string;
  status: number;
  issues?: { path: string; message: string }[];
};

export type CreateRequestResult = {
  transferId: string;
  kind: "request";
  status: TransferStatus;
  uploadUrl: string;
  downloadUrl: string;
  manageUrl: string;
  pollUrl: string;
  expiresAt: string;
};

export type CreateSendResult = {
  transferId: string;
  kind: "send";
  status: TransferStatus;
  downloadUrl: string;
  manageUrl: string;
  pollUrl: string;
  expiresAt: string;
  files: RegisteredFile[];
};

export function isTransferServiceError(value: unknown): value is TransferServiceError {
  return typeof value === "object" && value !== null && "code" in value && "status" in value;
}

function invalidCreate(parsed: {
  error: { issues: { path: (string | number)[]; message: string }[] };
}): TransferServiceError {
  const issues = parsed.error.issues.map((issue) => ({
    path: issue.path.join(".") || "body",
    message: issue.message,
  }));
  return {
    code: "invalid_request",
    message: issues[0]?.message ?? "Request is not usable",
    status: 400,
    issues,
  };
}

export function urlsFor(
  transfer: Transfer,
  baseUrl: string = publicOrigin(),
): { uploadUrl: string; downloadUrl: string; manageUrl: string; pollUrl: string } {
  const human = `${baseUrl}/s/${transfer.id}?t=${transfer.publicToken}`;
  return {
    uploadUrl: human,
    downloadUrl: human,
    manageUrl: `${baseUrl}/s/${transfer.id}/manage?token=${transfer.agentToken}`,
    pollUrl: `${baseUrl}/api/v1/transfers/${transfer.id}?token=${transfer.agentToken}`,
  };
}

export function liveStatus(transfer: Transfer, now: Date): TransferStatus {
  if (transfer.status === "cancelled" || transfer.status === "complete") {
    return transfer.status;
  }
  if (Date.parse(transfer.expiresAt) <= now.getTime()) {
    return "expired";
  }
  return transfer.status;
}

export type AgentFile = {
  id: string;
  name: string;
  size: number;
  type: string;
  scanStatus: string;
  scanSignature?: string;
  downloadUrl?: string;
  downloadUrlExpiresAt?: string;
};

export type AgentTransferView = {
  transferId: string;
  kind: Transfer["kind"];
  status: TransferStatus;
  title: string;
  message?: string;
  uploadUrl: string;
  downloadUrl: string;
  manageUrl: string;
  pollUrl: string;
  expiresAt: string;
  files: AgentFile[];
};

export type WaitResult = AgentTransferView & {
  timedOut: boolean;
  waitedSeconds: number;
  nextAction?: "wait";
};

export type CancelResult = {
  transferId: string;
  kind: Transfer["kind"];
  status: Extract<TransferStatus, "cancelled">;
  title: string;
  message?: string;
  expiresAt: string;
};

export type MergeResult = {
  primaryTransferId: string;
  secondaryTransferId: string;
  movedFileCount: number;
  totalFileCount: number;
  secondaryFileCount: 0;
  downloadUrl: string;
  expiresAt: string;
};

export type RegisteredFile = {
  id: string;
  name: string;
  size: number;
  type: string;
  uploadUrl: string;
  expiresAt: string;
};

export type RegisterFilesResult = {
  files: RegisteredFile[];
};

export type SealedFile = {
  id: string;
  name: string;
  size: number;
  type: string;
};

export type CompleteResult = {
  transferId: string;
  status: Extract<TransferStatus, "complete" | "ready" | "scanning" | "cancelled">;
  files: SealedFile[];
};

export type RefreshUrlResult = {
  uploadUrl: string;
  expiresAt: string;
};

export type PublicFileView = {
  id: string;
  name: string;
  size: number;
  type: string;
  state: TransferFile["state"];
  scanStatus?: string;
  downloadUrl?: string;
  downloadUrlExpiresAt?: string;
};

export type PublicTransferView = {
  transferId: string;
  kind: Transfer["kind"];
  status: TransferStatus;
  title: string;
  message?: string;
  expiresAt: string;
  maxFiles?: number;
  maxFileSize?: number;
  allowedTypes?: string[];
  files: PublicFileView[];
};

export type HumanScreen =
  | "open"
  | "complete"
  | "ready"
  | "not_ready"
  | "scanning"
  | "expired"
  | "cancelled"
  | "unknown";

export function humanScreenFor(view: PublicTransferView | TransferServiceError): HumanScreen {
  if (isTransferServiceError(view)) {
    return "unknown";
  }
  if (view.kind === "send") {
    if (view.status === "ready") {
      return "ready";
    }
    if (view.status === "open" || view.status === "scanning") {
      return "not_ready";
    }
  }
  if (view.status === "scanning") {
    return "scanning";
  }
  if (view.status === "complete") {
    return "complete";
  }
  if (view.status === "expired") {
    return "expired";
  }
  if (view.status === "cancelled") {
    return "cancelled";
  }
  return "open";
}

export function uploadPageCopy(screen: HumanScreen): { heading: string; body: string } {
  switch (screen) {
    case "open":
      return {
        heading: "Drop files here",
        body: "Choose files or drop them on this page. You can remove a file before you finish.",
      };
    case "complete":
      return {
        heading: "These files have been sent",
        body: "This request is finished. A new batch needs a new link.",
      };
    case "ready":
      return {
        heading: "Files for you",
        body: "Each file downloads on its own. There is no zip of everything.",
      };
    case "not_ready":
      return {
        heading: "These files are not ready yet",
        body: "They are still being prepared. Try this link again in a moment.",
      };
    case "scanning":
      return {
        heading: "We're checking these files",
        body: "They have arrived. This page will update once the check finishes.",
      };
    case "expired":
      return {
        heading: "This link has expired",
        body: "Files can no longer be added or taken on this link.",
      };
    case "cancelled":
      return {
        heading: "This transfer was cancelled",
        body: "Nothing more can be added or taken on this link.",
      };
    case "unknown":
      return {
        heading: "This link is not valid",
        body: "It may have been copied wrong, or it may never have existed.",
      };
  }
}

function publicView(transfer: Transfer): PublicTransferView {
  return {
    transferId: transfer.id,
    kind: transfer.kind,
    status: transfer.status,
    title: transfer.title,
    message: transfer.message,
    expiresAt: transfer.expiresAt,
    maxFiles: transfer.maxFiles,
    maxFileSize: transfer.maxFileSize,
    allowedTypes: transfer.allowedTypes,
    files: (transfer.files ?? []).map((file) => ({
      id: file.id,
      name: file.filename,
      size: file.size,
      type: file.contentType,
      state: file.state,
      scanStatus: file.scanStatus,
    })),
  };
}

export type TransferServiceDeps = {
  store: TransferStore;
  now: () => Date;
  createId: () => string;
  createFileId?: () => string;
  createToken: () => string;
  sleep?: (ms: number) => Promise<void>;
  waitPollMs?: number;
  objectStore?: ObjectStore | null;
  scanner?: Cleanroom | null;
  ownedMetadata?: LibraryMetadata;
};

export function defaultTransferServiceDeps(
  store: TransferStore,
  objectStore?: ObjectStore | null,
  scanner?: Cleanroom | null,
  ownedMetadata?: LibraryMetadata,
): TransferServiceDeps {
  return {
    store,
    now: () => new Date(),
    createId,
    createToken,
    objectStore,
    scanner,
    ownedMetadata,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

async function fileHasAuthority(deps: TransferServiceDeps, transferId: string, fileId: string) {
  const allowed = deps.store.fileAccess ? await deps.store.fileAccess(transferId) : null;
  return allowed === null || allowed.includes(fileId);
}

async function filesForAgent(deps: TransferServiceDeps, transfer: Transfer): Promise<AgentFile[]> {
  if (transfer.status === "open") {
    return [];
  }
  const accepted = (transfer.files ?? []).filter((file) => file.state === "accepted");
  const listed: AgentFile[] = [];
  for (const file of accepted) {
    const scanStatus = file.scanStatus ?? "scanning";
    const item: AgentFile = {
      id: file.id,
      name: file.filename,
      size: file.size,
      type: file.contentType,
      scanStatus,
      scanSignature: file.scanSignature,
    };
    if (
      isTakeableScan(scanStatus) &&
      file.key &&
      retainedFileAvailable(file, deps.now()) &&
      deps.objectStore?.available() &&
      (await fileHasAuthority(deps, transfer.id, file.id))
    ) {
      const signed = await deps.objectStore.presignGet({
        key: file.key,
        filename: file.filename,
        contentType: file.contentType,
        ...(file.retainedUntil ? { expiresInSeconds: readLifetime(file, deps.now()) } : {}),
      });
      item.downloadUrl = signed.url;
      item.downloadUrlExpiresAt = signed.expiresAt;
    }
    listed.push(item);
  }
  return listed;
}

async function agentView(
  deps: TransferServiceDeps,
  transfer: Transfer,
): Promise<AgentTransferView> {
  const urls = urlsFor(transfer);
  return {
    transferId: transfer.id,
    kind: transfer.kind,
    status: transfer.status,
    title: transfer.title,
    message: transfer.message,
    uploadUrl: urls.uploadUrl,
    downloadUrl: urls.downloadUrl,
    manageUrl: urls.manageUrl,
    pollUrl: urls.pollUrl,
    expiresAt: transfer.expiresAt,
    files: await filesForAgent(deps, transfer),
  };
}

function cancelView(transfer: Transfer): CancelResult {
  return {
    transferId: transfer.id,
    kind: transfer.kind,
    status: "cancelled",
    title: transfer.title,
    message: transfer.message,
    expiresAt: transfer.expiresAt,
  };
}

async function markCallbackAttempted(deps: TransferServiceDeps, transfer: Transfer): Promise<void> {
  if (!transfer.callbackUrl || transfer.callbackSent) {
    return;
  }
  await deps.store.compareAndSave([
    { before: transfer, after: { ...transfer, callbackSent: true } },
  ]);
}

function requireObjectStore(
  store: ObjectStore | null | undefined,
): ObjectStore | TransferServiceError {
  if (!store || !store.available()) {
    return { code: "store_unavailable", message: "File storage is not configured", status: 503 };
  }
  return store;
}

function fileCaps(transfer: Transfer): {
  maxFiles: number;
  maxFileSize: number;
  maxBytes: number;
  allowedTypes?: string[];
} {
  return {
    maxFiles: Math.min(transfer.maxFiles ?? FILE_MAX_COUNT, FILE_MAX_COUNT),
    maxFileSize: Math.min(transfer.maxFileSize ?? FILE_MAX_BYTES, FILE_MAX_BYTES),
    maxBytes: TRANSFER_MAX_BYTES,
    allowedTypes: transfer.allowedTypes,
  };
}

function typeAllowed(offered: string, allowed?: string[]): boolean {
  if (!allowed || allowed.length === 0) {
    return true;
  }
  const needle = offered.trim().toLowerCase();
  return allowed.some((item) => item.trim().toLowerCase() === needle);
}

function refuseOfferedFiles(
  existing: TransferFile[],
  offered: { name: string; type?: string; size: number }[],
  cap: { maxFiles: number; maxFileSize: number; maxBytes: number; allowedTypes?: string[] },
): TransferServiceError | null {
  if (existing.length + offered.length > cap.maxFiles) {
    return { code: "too_many", message: "Too many files for this transfer", status: 400 };
  }
  const existingBytes = existing.reduce((sum, file) => sum + file.size, 0);
  const offeredBytes = offered.reduce((sum, file) => sum + file.size, 0);
  if (existingBytes + offeredBytes > cap.maxBytes) {
    return {
      code: "transfer_too_large",
      message: "This transfer would exceed 20 GiB",
      status: 400,
    };
  }
  for (const file of offered) {
    if (file.size > cap.maxFileSize) {
      return {
        code: "too_large",
        message: "A file is larger than this transfer allows",
        status: 400,
      };
    }
    const contentType = file.type?.trim() || "application/octet-stream";
    if (!typeAllowed(contentType, cap.allowedTypes)) {
      return {
        code: "kind_not_allowed",
        message: "That kind of file is not accepted",
        status: 400,
      };
    }
  }
  return null;
}

function completeView(transfer: Transfer): CompleteResult {
  const status =
    transfer.status === "ready"
      ? "ready"
      : transfer.status === "scanning"
        ? "scanning"
        : transfer.status === "cancelled"
          ? "cancelled"
          : "complete";
  return {
    transferId: transfer.id,
    status,
    files: (transfer.files ?? [])
      .filter((file) => file.state === "accepted")
      .map((file) => ({
        id: file.id,
        name: file.filename,
        size: file.size,
        type: file.contentType,
      })),
  };
}

function accountSummary(transfer: Transfer, now: Date) {
  const status = liveStatus(transfer, now);
  const publicAccessAvailable =
    Date.parse(transfer.expiresAt) > now.getTime() &&
    (transfer.kind === "send" ? status === "ready" : status === "open");
  return {
    id: transfer.id,
    kind: transfer.kind,
    title: transfer.title,
    createdAt: transfer.createdAt,
    expiresAt: transfer.expiresAt,
    status,
    fileCount: transfer.files?.length ?? 0,
    acceptedFileCount: (transfer.files ?? []).filter((file) => file.state === "accepted").length,
    publicAccessAvailable,
    ...(publicAccessAvailable ? { publicUrl: urlsFor(transfer).uploadUrl } : {}),
    canCancel:
      Date.parse(transfer.expiresAt) > now.getTime() &&
      (status === "open" ||
        status === "scanning" ||
        (transfer.kind === "send" && status === "ready")),
  };
}

export function createTransferService(deps: TransferServiceDeps) {
  const scanner = deps.scanner === undefined ? createMemoryCleanroom() : deps.scanner;

  async function saveIfCurrent(before: Transfer, after: Transfer): Promise<Transfer> {
    if (await deps.store.compareAndSave([{ before, after }])) return after;
    // Deleted authority must not reuse a stale clean file to issue a read URL.
    return (await deps.store.getById(before.id)) ?? { ...before, status: "cancelled", files: [] };
  }

  async function loadForPublic(
    transferId: string,
    publicToken: string | undefined,
  ): Promise<Transfer | TransferServiceError> {
    const transfer = await deps.store.getById(transferId);
    if (!transfer || !publicToken || !tokensMatch(publicToken, transfer.publicToken)) {
      return { code: "not_found", message: "Transfer not found", status: 404 };
    }
    return { ...transfer, status: liveStatus(transfer, deps.now()) };
  }

  async function loadForAgent(
    transferId: string,
    agentToken: string | undefined,
  ): Promise<Transfer | TransferServiceError> {
    const transfer = await deps.store.getById(transferId);
    if (!transfer || !agentToken || !tokensMatch(agentToken, transfer.agentToken)) {
      return { code: "not_found", message: "Transfer not found", status: 404 };
    }
    return { ...transfer, status: liveStatus(transfer, deps.now()) };
  }

  function scanCallbackUrl(): string {
    return `${scanCallbackOrigin()}/api/v1/scans/callback`;
  }

  function scanFileUrl(url: string): string {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      return url;
    }
    return `${publicOrigin()}${url}`;
  }

  async function applyVerdict(
    transfer: Transfer,
    fileId: string,
    verdict: CleanroomVerdict,
    expected: Transfer = transfer,
  ): Promise<Transfer> {
    const original = transfer.files?.find((file) => file.id === fileId);
    if (!original || isTerminalScan(original.scanStatus)) return transfer;
    const files = (transfer.files ?? []).map((file) => {
      if (file.id !== fileId || isTerminalScan(file.scanStatus)) {
        return file;
      }
      return {
        ...file,
        scanStatus: scanStatusFromVerdict(verdict),
        scanSignature: verdict.verdict === "infected" ? verdict.signature : file.scanSignature,
        scanReason: verdict.verdict === "failed" ? verdict.reason : file.scanReason,
      };
    });
    const target = files.find((file) => file.id === fileId);
    const next = { ...transfer, files };
    const saved = await saveIfCurrent(expected, next);
    if (
      saved === next &&
      verdict.verdict === "infected" &&
      target?.key &&
      deps.objectStore?.available()
    ) {
      await deps.objectStore.delete(target.key);
    }
    return saved;
  }

  async function finalizeIfScanned(transfer: Transfer): Promise<Transfer> {
    if (liveStatus(transfer, deps.now()) !== "scanning") {
      return transfer;
    }
    const accepted = (transfer.files ?? []).filter((file) => file.state === "accepted");
    if (accepted.length === 0 || accepted.some((file) => !isTerminalScan(file.scanStatus))) {
      return transfer;
    }
    const takeable = accepted.filter((file) => isTakeableScan(file.scanStatus));
    if (transfer.kind === "send" && takeable.length === 0) {
      const next: Transfer = {
        ...transfer,
        status: "cancelled",
        cancelledAt: deps.now().toISOString(),
      };
      const saved = await saveIfCurrent(transfer, next);
      await markCallbackAttempted(deps, saved);
      return saved;
    }
    const next: Transfer = {
      ...transfer,
      status: transfer.kind === "send" ? "ready" : "complete",
      completedAt: deps.now().toISOString(),
    };
    const saved = await saveIfCurrent(transfer, next);
    await markCallbackAttempted(deps, saved);
    return saved;
  }

  async function submitScans(transfer: Transfer, expected: Transfer = transfer): Promise<Transfer> {
    const store = deps.objectStore;
    let current = transfer;
    const files = [...(current.files ?? [])];
    const infectedKeys: string[] = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      if (
        !file ||
        file.state !== "accepted" ||
        file.scanHandle ||
        isTerminalScan(file.scanStatus)
      ) {
        continue;
      }
      if (!file.key || !store?.available()) {
        files[index] = { ...file, scanStatus: "failed", scanReason: "store unavailable" };
        continue;
      }
      if (file.size > SCAN_SIZE_CAP_BYTES) {
        files[index] = { ...file, scanStatus: "skipped-too-large" };
        continue;
      }
      if (!scanner?.available()) {
        files[index] = { ...file, scanStatus: "failed", scanReason: "scanner unavailable" };
        continue;
      }
      if (!(await fileHasAuthority(deps, current.id, file.id))) continue;
      try {
        const signed = await store.presignGet({
          key: file.key,
          filename: file.filename,
          contentType: file.contentType,
          expiresInSeconds: SCAN_LINK_TTL_SECONDS,
        });
        const submitted = await scanner.submit({
          url: scanFileUrl(signed.url),
          callbackUrl: scanCallbackUrl(),
          declaredSizeBytes: file.size,
          submissionKey: `${current.id}:${file.id}`,
        });
        files[index] = {
          ...file,
          scanHandle: submitted.handle,
          scanStatus: submitted.verdict ? scanStatusFromVerdict(submitted.verdict) : "scanning",
          scanSignature:
            submitted.verdict?.verdict === "infected" ? submitted.verdict.signature : undefined,
          scanReason:
            submitted.verdict?.verdict === "failed" ? submitted.verdict.reason : undefined,
        };
        if (submitted.verdict?.verdict === "infected") {
          infectedKeys.push(file.key);
        }
      } catch {
        files[index] = { ...file, scanStatus: "failed", scanReason: "submit failed" };
      }
    }
    current = { ...current, files };
    const saved = await saveIfCurrent(expected, current);
    if (saved === current && store?.available()) {
      for (const key of infectedKeys) await store.delete(key);
    }
    return await finalizeIfScanned(saved);
  }

  async function arriveAndScan(transfer: Transfer): Promise<Transfer> {
    const initialStatus = liveStatus(transfer, deps.now());
    if (initialStatus !== "open") {
      return transfer;
    }
    const store = deps.objectStore;
    if (!store?.available()) {
      return transfer;
    }
    const pending = transfer.files ?? [];
    if (pending.length === 0) {
      return transfer;
    }
    // Owned uploads are sealed under a frozen key before any scan/read verdict.
    // The original signed PUT can alter staging only, never the checked bytes.
    if (transfer.ownerAccountId && pending.some((file) => file.uploadExpiresAt)) {
      if (!deps.ownedMetadata) return transfer;
      for (const offered of pending) {
        const current = await deps.store.getById(transfer.id);
        if (!current || liveStatus(current, deps.now()) !== "open") return current ?? transfer;
        const file = current.files?.find((candidate) => candidate.id === offered.id);
        if (!file) return current;
        if (file.state === "accepted") continue;
        if (file.key !== ownedUploadKey(current.id, file.id)) return current;
        let head;
        try {
          head = await store.head(file.key);
        } catch {
          return current;
        }
        if (!head || head.size !== file.size) return current;
        const attemptId = randomUUID();
        const grant = await deps.ownedMetadata.call("beginSeal", {
          id: current.id,
          fileId: file.id,
          attemptId,
        });
        if (grant === null) return (await deps.store.getById(current.id)) ?? current;
        if (grant && typeof grant === "object" && "sealed" in grant && grant.sealed === true) {
          // Another worker committed between this read and lease acquisition.
          // Its frozen object must never receive a second COPY.
          const latest = await deps.store.getById(current.id);
          if (latest?.files?.find((candidate) => candidate.id === file.id)?.state === "accepted")
            continue;
          return latest ?? { ...current, status: "cancelled", files: [] };
        }
        if (
          !grant ||
          typeof grant !== "object" ||
          !("uploadKey" in grant) ||
          !("objectKey" in grant) ||
          !("size" in grant) ||
          !("attemptId" in grant) ||
          !("deadlineAt" in grant) ||
          grant.uploadKey !== file.key ||
          grant.objectKey !== `sharemeatsack/owned/${current.id}/${file.id}/sealed/${attemptId}` ||
          grant.size !== file.size ||
          grant.attemptId !== attemptId ||
          typeof grant.deadlineAt !== "number" ||
          grant.deadlineAt <= deps.now().getTime()
        )
          throw new OwnedTransferError("unavailable", 503);
        try {
          await store.copy(grant.uploadKey, grant.objectKey);
          const sealed = await store.head(grant.objectKey);
          if (!sealed || sealed.size !== file.size) throw new Error("Incomplete sealed upload");
          const committed = await deps.ownedMetadata.call("commitSeal", {
            id: current.id,
            fileId: file.id,
            attemptId,
            observedBytes: sealed.size,
          });
          if (committed !== true) return (await deps.store.getById(current.id)) ?? current;
        } catch {
          await deps.ownedMetadata.call("failSeal", { id: current.id, fileId: file.id, attemptId });
          return (await deps.store.getById(current.id)) ?? current;
        }
      }
      const sealed = await deps.store.getById(transfer.id);
      if (
        !sealed ||
        liveStatus(sealed, deps.now()) !== "open" ||
        !sealed.files?.length ||
        sealed.files.some((file) => file.state !== "accepted")
      )
        return sealed ?? transfer;
      const next: Transfer = { ...sealed, status: "scanning" };
      const saved = await saveIfCurrent(sealed, next);
      return await submitScans(saved);
    }
    const accepted: TransferFile[] = [];
    for (const file of pending) {
      if (!file.key) {
        return transfer;
      }
      let head;
      try {
        head = await store.head(file.key);
      } catch {
        // A transient metadata outage keeps the transfer open for a later poll.
        return transfer;
      }
      if (!head || head.size !== file.size) {
        return transfer;
      }
      accepted.push({
        ...file,
        state: "accepted",
        // This is the first verified arrival, not a date inferred during a later claim.
        receivedAt: file.receivedAt ?? deps.now().toISOString(),
        scanStatus: file.scanStatus ?? "scanning",
      });
    }
    const next: Transfer = {
      ...transfer,
      status: "scanning",
      files: accepted,
    };
    const saved = await saveIfCurrent(transfer, next);
    return await submitScans(saved);
  }

  async function refreshScans(transfer: Transfer): Promise<Transfer> {
    const status = liveStatus(transfer, deps.now());
    if (status === "open" && transfer.kind === "send") {
      return await arriveAndScan(transfer);
    }
    if (status !== "scanning") {
      return { ...transfer, status };
    }
    let current: Transfer = { ...transfer, status };
    let expected = transfer;
    if (!scanner?.available()) {
      return current;
    }
    for (const file of current.files ?? []) {
      if (!file.scanHandle || isTerminalScan(file.scanStatus)) {
        continue;
      }
      let polled;
      try {
        polled = await scanner.poll(file.scanHandle);
      } catch {
        continue;
      }
      if (!polled) {
        current = {
          ...current,
          files: current.files?.map((candidate) =>
            candidate.id === file.id ? { ...candidate, scanHandle: undefined } : candidate,
          ),
        };
        continue;
      }
      if (polled?.verdict) {
        current = await applyVerdict(current, file.id, polled.verdict, expected);
        expected = current;
      }
    }
    return await submitScans(current, expected);
  }

  async function authorizeFileMutation(input: {
    transferId: string;
    publicToken?: string;
    agentToken?: string;
  }): Promise<Transfer | TransferServiceError> {
    const existing = await deps.store.getById(input.transferId);
    if (!existing) {
      return { code: "not_found", message: "Transfer not found", status: 404 };
    }
    if (existing.kind === "send") {
      return await loadForAgent(input.transferId, input.agentToken);
    }
    return await loadForPublic(input.transferId, input.publicToken);
  }

  return {
    async createRequest(
      body: unknown,
      ownerAccountId?: string,
    ): Promise<CreateRequestResult | TransferServiceError> {
      if (body && typeof body === "object" && "action" in body) {
        const action = (body as { action?: unknown }).action;
        if (action !== undefined && action !== "request") {
          return {
            code: "invalid_action",
            message: "action must be request",
            status: 400,
          };
        }
      }

      const parsed = requestCreateSchema.safeParse(body);
      if (!parsed.success) {
        return invalidCreate(parsed);
      }

      const input = parsed.data;
      const createdAt = deps.now();
      const ttlSeconds = input.expiresInSeconds ?? TRANSFER_DEFAULT_TTL_SECONDS;
      const transfer: Transfer = {
        id: deps.createId(),
        kind: "request",
        ownerAccountId,
        createdAt: createdAt.toISOString(),
        expiresAt: new Date(createdAt.getTime() + ttlSeconds * 1000).toISOString(),
        status: "open",
        title: input.title,
        message: input.message,
        publicToken: deps.createToken(),
        agentToken: deps.createToken(),
        metadata: input.metadata,
        callbackUrl: input.callbackUrl,
        maxFiles: input.maxFiles,
        maxFileSize: input.maxFileSize,
        allowedTypes: input.allowedTypes,
      };
      try {
        await deps.store.save(transfer);
      } catch (error) {
        if (ownerAccountId) return ownedStoreError(error);
        throw error;
      }
      const urls = urlsFor(transfer);
      return {
        transferId: transfer.id,
        kind: "request",
        status: transfer.status,
        uploadUrl: urls.uploadUrl,
        downloadUrl: urls.downloadUrl,
        manageUrl: urls.manageUrl,
        pollUrl: urls.pollUrl,
        expiresAt: transfer.expiresAt,
      };
    },

    async createSend(
      body: unknown,
      ownerAccountId?: string,
    ): Promise<CreateSendResult | TransferServiceError> {
      if (body && typeof body === "object" && "action" in body) {
        const action = (body as { action?: unknown }).action;
        if (action !== undefined && action !== "send") {
          return {
            code: "invalid_action",
            message: "action must be send",
            status: 400,
          };
        }
      }
      const parsed = sendCreateSchema.safeParse(body);
      if (!parsed.success) {
        return invalidCreate(parsed);
      }
      const store = requireObjectStore(deps.objectStore);
      if (isTransferServiceError(store)) {
        return store;
      }
      const refusal = refuseOfferedFiles([], parsed.data.files, {
        maxFiles: FILE_MAX_COUNT,
        maxFileSize: FILE_MAX_BYTES,
        maxBytes: TRANSFER_MAX_BYTES,
      });
      if (refusal) {
        return refusal;
      }

      const createdAt = deps.now();
      const ttlSeconds = parsed.data.expiresInSeconds ?? TRANSFER_DEFAULT_TTL_SECONDS;
      const id = deps.createId();
      const mintId = deps.createFileId ?? deps.createId;
      const files: TransferFile[] = [];
      const registered: RegisteredFile[] = [];
      for (const file of parsed.data.files) {
        const contentType = file.type?.trim() || "application/octet-stream";
        const fileId = mintId();
        const key = ownerAccountId
          ? ownedUploadKey(id, fileId)
          : fileObjectKey({ transferId: id, fileId, filename: file.name });
        files.push({
          id: fileId,
          filename: file.name,
          contentType,
          size: file.size,
          key,
          state: "pending",
          ...(ownerAccountId
            ? {
                uploadExpiresAt: new Date(
                  createdAt.getTime() + UPLOAD_URL_TTL_SECONDS * 1000,
                ).toISOString(),
              }
            : {}),
        });
      }
      const transfer: Transfer = {
        id,
        kind: "send",
        ownerAccountId,
        createdAt: createdAt.toISOString(),
        expiresAt: new Date(createdAt.getTime() + ttlSeconds * 1000).toISOString(),
        status: "open",
        title: parsed.data.title,
        message: parsed.data.message,
        publicToken: deps.createToken(),
        agentToken: deps.createToken(),
        metadata: parsed.data.metadata,
        callbackUrl: parsed.data.callbackUrl,
        files,
      };
      try {
        // Admission and the byte reservation succeed before a PUT can exist.
        await deps.store.save(transfer);
        for (const file of files) {
          const signed = await store.presignPut({
            key: file.key!,
            contentType: file.contentType,
            contentLength: file.size,
            ...(file.uploadExpiresAt
              ? {
                  expiresInSeconds: Math.max(
                    1,
                    Math.floor((Date.parse(file.uploadExpiresAt) - deps.now().getTime()) / 1000),
                  ),
                }
              : {}),
          });
          registered.push({
            id: file.id,
            name: file.filename,
            size: file.size,
            type: file.contentType,
            uploadUrl: signed.url,
            expiresAt: signed.expiresAt,
          });
        }
      } catch (error) {
        if (ownerAccountId) return ownedStoreError(error);
        throw error;
      }
      const urls = urlsFor(transfer);
      return {
        transferId: transfer.id,
        kind: "send",
        status: transfer.status,
        downloadUrl: urls.downloadUrl,
        manageUrl: urls.manageUrl,
        pollUrl: urls.pollUrl,
        expiresAt: transfer.expiresAt,
        files: registered,
      };
    },

    async create(
      body: unknown,
      ownerAccountId?: string,
    ): Promise<CreateRequestResult | CreateSendResult | TransferServiceError> {
      const action =
        body && typeof body === "object" && "action" in body
          ? (body as { action?: unknown }).action
          : "request";
      if (action === "send") {
        return await this.createSend(body, ownerAccountId);
      }
      return await this.createRequest(body, ownerAccountId);
    },

    async listForAccount(account: string, page: OwnerPage) {
      const result = await deps.store.listByOwner(account, page);
      return {
        ...result,
        records: result.records.map((transfer) => accountSummary(transfer, deps.now())),
      };
    },

    async getForAccount(account: string, transferId: string) {
      const transfer = await deps.store.getById(transferId);
      if (!transfer || transfer.ownerAccountId !== account) {
        return {
          code: "not_found",
          message: "Transfer not found",
          status: 404,
        } satisfies TransferServiceError;
      }
      const current = await refreshScans({ ...transfer, status: liveStatus(transfer, deps.now()) });
      const allowed = deps.store.fileAccess ? await deps.store.fileAccess(current.id) : null;
      const kept = deps.store.keptFiles ? await deps.store.keptFiles(account, current.id) : {};
      return {
        ...accountSummary(current, deps.now()),
        message: current.message,
        files: (current.files ?? []).map((file) => {
          const canRead =
            (allowed === null || allowed.includes(file.id)) &&
            current.status !== "open" &&
            file.state === "accepted" &&
            !!file.key &&
            isTakeableScan(file.scanStatus) &&
            retainedFileAvailable(file, deps.now());
          return {
            id: file.id,
            name: file.filename,
            size: file.size,
            type: file.contentType,
            state: file.state,
            scanStatus: file.scanStatus ?? "scanning",
            scanReason: file.scanReason,
            retainedUntil: file.retainedUntil,
            ...(kept[file.id] ? { keptLibraryId: kept[file.id] } : {}),
            canRead,
            canKeep:
              current.kind === "request" && canRead && !!file.receivedAt && !!file.retainedUntil,
          };
        }),
      };
    },

    async cancelForAccount(account: string, transferId: string) {
      const transfer = await deps.store.getById(transferId);
      if (!transfer || transfer.ownerAccountId !== account) {
        return {
          code: "not_found",
          message: "Transfer not found",
          status: 404,
        } satisfies TransferServiceError;
      }
      return this.cancel({ transferId, agentToken: transfer.agentToken });
    },

    loadForPublic,

    loadForAgent,

    async getForPublic(input: {
      transferId: string;
      publicToken?: string;
    }): Promise<PublicTransferView | TransferServiceError> {
      const loaded = await loadForPublic(input.transferId, input.publicToken);
      if (isTransferServiceError(loaded)) {
        return loaded;
      }
      const refreshed = await refreshScans(loaded);
      const transfer =
        Date.parse(refreshed.expiresAt) <= deps.now().getTime()
          ? { ...refreshed, status: "expired" as const }
          : refreshed;
      const view = publicView(transfer);
      if (transfer.status === "expired" || transfer.status === "cancelled")
        return { ...view, files: [] };
      if (transfer.kind === "send" && transfer.status !== "ready") {
        return { ...view, files: [] };
      }
      if (
        transfer.kind === "send" &&
        transfer.status === "ready" &&
        deps.objectStore?.available()
      ) {
        const files: PublicFileView[] = [];
        for (const file of transfer.files ?? []) {
          if (
            file.state !== "accepted" ||
            !file.key ||
            !isTakeableScan(file.scanStatus) ||
            !retainedFileAvailable(file, deps.now()) ||
            Date.parse(transfer.expiresAt) <= deps.now().getTime() ||
            !(await fileHasAuthority(deps, transfer.id, file.id))
          ) {
            continue;
          }
          // Public access can retire while current storage authority is being read.
          const latest = await deps.store.getById(transfer.id);
          const eligible = latest?.files?.find((candidate) => candidate.id === file.id);
          if (
            !latest ||
            latest.kind !== "send" ||
            latest.status !== "ready" ||
            !input.publicToken ||
            !tokensMatch(input.publicToken, latest.publicToken) ||
            Date.parse(latest.expiresAt) <= deps.now().getTime() ||
            !eligible ||
            eligible.key !== file.key ||
            eligible.state !== "accepted" ||
            !isTakeableScan(eligible.scanStatus) ||
            !retainedFileAvailable(eligible, deps.now())
          )
            continue;
          const signed = await deps.objectStore.presignGet({
            key: eligible.key!,
            filename: eligible.filename,
            contentType: eligible.contentType,
            expiresInSeconds: readLifetime(eligible, deps.now(), latest.expiresAt),
          });
          files.push({
            id: file.id,
            name: file.filename,
            size: file.size,
            type: file.contentType,
            state: file.state,
            scanStatus: file.scanStatus,
            downloadUrl: signed.url,
            downloadUrlExpiresAt: signed.expiresAt,
          });
        }
        return { ...view, files };
      }
      return view;
    },

    async getForAgent(input: {
      transferId: string;
      agentToken?: string;
    }): Promise<AgentTransferView | TransferServiceError> {
      const loaded = await loadForAgent(input.transferId, input.agentToken);
      if (isTransferServiceError(loaded)) {
        return loaded;
      }
      const transfer = await refreshScans(loaded);
      return await agentView(deps, transfer);
    },

    async listFiles(input: {
      transferId: string;
      agentToken?: string;
    }): Promise<{ files: AgentFile[] } | TransferServiceError> {
      const loaded = await loadForAgent(input.transferId, input.agentToken);
      if (isTransferServiceError(loaded)) {
        return loaded;
      }
      const transfer = await refreshScans(loaded);
      return { files: await filesForAgent(deps, transfer) };
    },

    async merge(input: {
      transferId: string;
      agentToken?: string;
      body: unknown;
    }): Promise<MergeResult | TransferServiceError> {
      const parsed = mergeTransfersSchema.safeParse(input.body);
      if (!parsed.success) return invalidCreate(parsed);
      const primary = await loadForAgent(input.transferId, input.agentToken);
      if (isTransferServiceError(primary)) return primary;
      const secondary = await loadForAgent(
        parsed.data.secondaryTransferId,
        parsed.data.secondaryAgentToken,
      );
      if (isTransferServiceError(secondary)) return secondary;
      if (primary.id === secondary.id) {
        return { code: "same_transfer", message: "Choose two different transfers", status: 400 };
      }
      if (primary.ownerAccountId !== secondary.ownerAccountId) {
        return {
          code: "not_mergeable",
          message: "These transfers have different storage authority",
          status: 409,
        };
      }
      for (const transfer of [primary, secondary]) {
        if (
          Date.parse(transfer.expiresAt) <= deps.now().getTime() ||
          (transfer.status !== "complete" && transfer.status !== "ready") ||
          (transfer.files ?? []).some(
            (file) => file.state !== "accepted" || !isTerminalScan(file.scanStatus),
          )
        ) {
          return {
            code: "not_mergeable",
            message: "Both transfers must be live and have finished uploading and scanning",
            status: 409,
          };
        }
      }
      const existing = primary.files ?? [];
      let moving = secondary.files ?? [];
      if (primary.ownerAccountId && primary.kind === "request" && secondary.kind === "send") {
        // Moving a claimed send into a request must retain its original upload clock.
        const now = deps.now().getTime();
        if (
          moving.some(
            (file) =>
              !file.libraryFileId &&
              (!file.receivedAt ||
                !Number.isFinite(Date.parse(file.receivedAt)) ||
                Date.parse(file.receivedAt) > now ||
                Date.parse(file.receivedAt) + 90 * 86_400_000 <= now),
          )
        ) {
          return {
            code: "not_mergeable",
            message: "The original file upload dates are unavailable or their retention has ended",
            status: 409,
          };
        }
        moving = moving.map((file) =>
          file.libraryFileId
            ? file
            : {
                ...file,
                retainedUntil: new Date(
                  Date.parse(file.receivedAt!) + 90 * 86_400_000,
                ).toISOString(),
              },
        );
      }
      const refusal = refuseOfferedFiles(
        existing,
        moving.map((file) => ({ name: file.filename, type: file.contentType, size: file.size })),
        fileCaps(primary),
      );
      if (refusal) return refusal;
      const ids = new Set(existing.map((file) => file.id));
      if (moving.some((file) => ids.has(file.id))) {
        return {
          code: "file_conflict",
          message: "File ids overlap between transfers",
          status: 409,
        };
      }
      const combined = [...existing, ...moving];
      if (
        !(await deps.store.compareAndSave([
          { before: primary, after: { ...primary, files: combined } },
          { before: secondary, after: { ...secondary, files: [] } },
        ]))
      ) {
        return {
          code: "merge_conflict",
          message: "A transfer changed during the merge; refresh status and retry",
          status: 409,
        };
      }
      return {
        primaryTransferId: primary.id,
        secondaryTransferId: secondary.id,
        movedFileCount: moving.length,
        totalFileCount: combined.length,
        secondaryFileCount: 0,
        downloadUrl: urlsFor(primary).downloadUrl,
        expiresAt: primary.expiresAt,
      };
    },

    async readFileUrl(input: {
      transferId: string;
      fileId: string;
      token?: string;
      purpose?: "preview" | "download";
    }): Promise<{ url: string; expiresAt: string } | TransferServiceError> {
      const unavailable: TransferServiceError = {
        code: "not_found",
        message: "File not found",
        status: 404,
      };
      const loaded = await deps.store.getById(input.transferId);
      if (!loaded || !input.token) return unavailable;
      const agent = tokensMatch(input.token, loaded.agentToken);
      const publicSend = loaded.kind === "send" && tokensMatch(input.token, loaded.publicToken);
      if (!agent && !publicSend) return unavailable;
      const transfer = await refreshScans({ ...loaded, status: liveStatus(loaded, deps.now()) });
      if (
        transfer.status === "open" ||
        (!agent &&
          (transfer.status !== "ready" || Date.parse(transfer.expiresAt) <= deps.now().getTime()))
      )
        return unavailable;
      const file = transfer.files?.find((item) => item.id === input.fileId);
      if (
        !file ||
        file.state !== "accepted" ||
        !file.key ||
        !isTakeableScan(file.scanStatus) ||
        !retainedFileAvailable(file, deps.now())
      ) {
        return unavailable;
      }
      if (!deps.objectStore?.available()) return unavailable;
      if (!(await fileHasAuthority(deps, transfer.id, file.id))) return unavailable;
      if (!(await deps.objectStore.head(file.key))) return unavailable;
      if (!retainedFileAvailable(file, deps.now())) return unavailable;
      const latest = await deps.store.getById(transfer.id);
      const eligible = latest?.files?.find((candidate) => candidate.id === file.id);
      if (
        !latest ||
        latest.status === "open" ||
        !(agent
          ? tokensMatch(input.token, latest.agentToken)
          : tokensMatch(input.token, latest.publicToken)) ||
        !eligible ||
        eligible.key !== file.key ||
        eligible.state !== "accepted" ||
        !isTakeableScan(eligible.scanStatus) ||
        !retainedFileAvailable(eligible, deps.now()) ||
        (!agent &&
          (latest.kind !== "send" ||
            latest.status !== "ready" ||
            Date.parse(latest.expiresAt) <= deps.now().getTime())) ||
        !(await fileHasAuthority(deps, latest.id, eligible.id))
      )
        return unavailable;
      return await deps.objectStore.presignGet({
        key: eligible.key!,
        filename: eligible.filename,
        contentType: eligible.contentType,
        purpose: input.purpose ?? "download",
        expiresInSeconds: readLifetime(eligible, deps.now(), agent ? undefined : latest.expiresAt),
      });
    },

    async readFileForAccount(input: {
      account: string;
      transferId: string;
      fileId: string;
      purpose?: "preview" | "download";
    }): Promise<{ url: string; expiresAt: string } | TransferServiceError> {
      const unavailable: TransferServiceError = {
        code: "not_found",
        message: "File not found",
        status: 404,
      };
      const loaded = await deps.store.getById(input.transferId);
      if (!loaded || loaded.ownerAccountId !== input.account) return unavailable;
      const current = await refreshScans(loaded);
      const file = current.files?.find((candidate) => candidate.id === input.fileId);
      if (
        current.status === "open" ||
        !file ||
        file.state !== "accepted" ||
        !file.key ||
        !isTakeableScan(file.scanStatus) ||
        !retainedFileAvailable(file, deps.now()) ||
        !deps.objectStore?.available()
      )
        return unavailable;
      if (!(await fileHasAuthority(deps, current.id, file.id))) return unavailable;
      if (!(await deps.objectStore.head(file.key)) || !retainedFileAvailable(file, deps.now()))
        return unavailable;
      // Re-read durable authority after the provider wait; removal may have won.
      const latest = await deps.store.getById(current.id);
      const eligible = latest?.files?.find((candidate) => candidate.id === file.id);
      if (
        latest?.ownerAccountId !== input.account ||
        !eligible ||
        eligible.key !== file.key ||
        eligible.state !== "accepted" ||
        !isTakeableScan(eligible.scanStatus) ||
        !retainedFileAvailable(eligible, deps.now()) ||
        !(await fileHasAuthority(deps, current.id, eligible.id))
      )
        return unavailable;
      const signed = await deps.objectStore.presignGet({
        key: eligible.key!,
        filename: eligible.filename,
        contentType: eligible.contentType,
        purpose: input.purpose ?? "download",
        expiresInSeconds: readLifetime(eligible, deps.now()),
      });
      return { url: new URL(signed.url, publicOrigin()).href, expiresAt: signed.expiresAt };
    },

    async markdownForManage(input: {
      transferId: string;
      agentToken?: string;
    }): Promise<string | TransferServiceError> {
      const transfer = await loadForAgent(input.transferId, input.agentToken);
      if (isTransferServiceError(transfer)) {
        return transfer;
      }
      return manageMarkdown(await agentView(deps, transfer));
    },

    async cancel(input: {
      transferId: string;
      agentToken?: string;
      publicToken?: string;
    }): Promise<CancelResult | TransferServiceError> {
      const existing = await deps.store.getById(input.transferId);
      if (!existing) {
        return { code: "not_found", message: "Transfer not found", status: 404 };
      }
      const asAgent =
        input.agentToken !== undefined && tokensMatch(input.agentToken, existing.agentToken);
      const asPerson =
        existing.kind === "request" &&
        input.publicToken !== undefined &&
        tokensMatch(input.publicToken, existing.publicToken);
      if (!asAgent && !asPerson) {
        return { code: "not_found", message: "Transfer not found", status: 404 };
      }
      const current = liveStatus(existing, deps.now());
      if (current === "cancelled") {
        return cancelView({ ...existing, status: "cancelled" });
      }
      if (current === "complete" || current === "expired") {
        return {
          code: "frozen",
          message: "Transfer can no longer be cancelled",
          status: 409,
        };
      }
      if (existing.kind === "request" && current === "ready") {
        return {
          code: "frozen",
          message: "Transfer can no longer be cancelled",
          status: 409,
        };
      }
      const next: Transfer = {
        ...existing,
        status: "cancelled",
        cancelledAt: deps.now().toISOString(),
      };
      if (!(await deps.store.compareAndSave([{ before: existing, after: next }]))) {
        return {
          code: "frozen",
          message: "Transfer changed; refresh status and retry",
          status: 409,
        };
      }
      await markCallbackAttempted(deps, next);
      return cancelView(next);
    },

    async wait(input: {
      transferId: string;
      agentToken?: string;
      seconds?: number;
    }): Promise<WaitResult | TransferServiceError> {
      const parsed = waitSchema.safeParse({ seconds: input.seconds });
      if (!parsed.success) {
        return {
          code: "invalid_bound",
          message: `Wait bound must be between 1 and ${WAIT_MAX_SECONDS} seconds`,
          status: 400,
        };
      }
      const startedAt = deps.now().getTime();
      const waitSeconds = Math.min(parsed.data.seconds, WAIT_BUDGET_SECONDS);
      const deadline = startedAt + waitSeconds * 1000;
      const pollMs = deps.waitPollMs ?? WAIT_POLL_MS;
      const sleep =
        deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
      while (true) {
        const loaded = await loadForAgent(input.transferId, input.agentToken);
        if (isTransferServiceError(loaded)) {
          return loaded;
        }
        const transfer = await refreshScans(loaded);
        const waitedSeconds = Math.round((deps.now().getTime() - startedAt) / 1000);
        if (isTerminalStatus(transfer.status)) {
          return { ...(await agentView(deps, transfer)), timedOut: false, waitedSeconds };
        }
        const remaining = deadline - deps.now().getTime();
        if (remaining <= 0) {
          return {
            ...(await agentView(deps, transfer)),
            timedOut: true,
            waitedSeconds,
            nextAction: "wait",
          };
        }
        await sleep(Math.min(pollMs, remaining));
      }
    },

    async registerFiles(input: {
      transferId: string;
      publicToken?: string;
      body: unknown;
    }): Promise<RegisterFilesResult | TransferServiceError> {
      const transfer = await loadForPublic(input.transferId, input.publicToken);
      if (isTransferServiceError(transfer)) {
        return transfer;
      }
      if (transfer.kind !== "request" || liveStatus(transfer, deps.now()) !== "open") {
        return { code: "closed", message: "Transfer is not accepting files", status: 409 };
      }
      const store = requireObjectStore(deps.objectStore);
      if (isTransferServiceError(store)) {
        return store;
      }
      const parsed = registerFilesSchema.safeParse(input.body);
      if (!parsed.success) {
        return invalidCreate(parsed);
      }

      const latest = (await deps.store.getById(transfer.id)) ?? transfer;
      if (latest.kind !== "request" || liveStatus(latest, deps.now()) !== "open") {
        return { code: "closed", message: "Transfer is not accepting files", status: 409 };
      }
      const existing = latest.files ?? [];
      const offered = parsed.data.files;
      const cap = fileCaps(latest);
      const refusal = refuseOfferedFiles(existing, offered, cap);
      if (refusal) {
        return refusal;
      }

      const mintId = deps.createFileId ?? deps.createId;
      const registered: RegisteredFile[] = [];
      const newFiles: TransferFile[] = [];
      const nextFiles = [...existing];
      const offeredAt = deps.now();
      let durableOwned = false;
      if (latest.ownerAccountId && deps.ownedMetadata) {
        try {
          durableOwned =
            typeof (await deps.ownedMetadata.call("getById", { id: latest.id })) === "string";
        } catch (error) {
          return ownedStoreError(error);
        }
      }
      for (const file of offered) {
        const contentType = file.type?.trim() || "application/octet-stream";
        const id = mintId();
        const key = durableOwned
          ? ownedUploadKey(latest.id, id)
          : fileObjectKey({ transferId: latest.id, fileId: id, filename: file.name });
        const offeredFile: TransferFile = {
          id,
          filename: file.name,
          contentType,
          size: file.size,
          key,
          state: "pending",
          ...(durableOwned
            ? {
                uploadExpiresAt: new Date(
                  offeredAt.getTime() + UPLOAD_URL_TTL_SECONDS * 1000,
                ).toISOString(),
              }
            : {}),
        };
        nextFiles.push(offeredFile);
        newFiles.push(offeredFile);
      }
      let saved: boolean;
      try {
        saved = await deps.store.compareAndSave([
          { before: latest, after: { ...latest, files: nextFiles } },
        ]);
      } catch (error) {
        if (latest.ownerAccountId) return ownedStoreError(error);
        throw error;
      }
      if (!saved) {
        return {
          code: "closed",
          message: "Transfer changed; refresh status and retry",
          status: 409,
        };
      }
      for (const file of newFiles) {
        const signed = await store.presignPut({
          key: file.key!,
          contentType: file.contentType,
          contentLength: file.size,
          ...(file.uploadExpiresAt
            ? {
                expiresInSeconds: Math.max(
                  1,
                  Math.floor((Date.parse(file.uploadExpiresAt) - deps.now().getTime()) / 1000),
                ),
              }
            : {}),
        });
        registered.push({
          id: file.id,
          name: file.filename,
          size: file.size,
          type: file.contentType,
          uploadUrl: signed.url,
          expiresAt: signed.expiresAt,
        });
      }
      return { files: registered };
    },

    async complete(input: {
      transferId: string;
      publicToken?: string;
      agentToken?: string;
    }): Promise<CompleteResult | TransferServiceError> {
      const transfer = await authorizeFileMutation(input);
      if (isTransferServiceError(transfer)) {
        return transfer;
      }
      const current = liveStatus(transfer, deps.now());
      if (current === "complete" || current === "ready" || current === "cancelled") {
        return completeView({ ...transfer, status: current });
      }
      if (current === "scanning") {
        return completeView(await refreshScans(transfer));
      }
      if (current !== "open") {
        return { code: "closed", message: "Transfer is not accepting files", status: 409 };
      }
      if (transfer.kind === "send") {
        const sealed = await arriveAndScan(transfer);
        if (sealed.status === "open") {
          return { code: "incomplete_upload", message: "Not every file has arrived", status: 409 };
        }
        return completeView(sealed);
      }
      const store = requireObjectStore(deps.objectStore);
      if (isTransferServiceError(store)) {
        return store;
      }
      const pending = transfer.files ?? [];
      if (pending.length === 0) {
        return { code: "no_files", message: "Nothing has been offered yet", status: 400 };
      }
      const sealed = await arriveAndScan(transfer);
      if (sealed.status === "open") {
        return { code: "incomplete_upload", message: "Not every file has arrived", status: 409 };
      }
      return completeView(sealed);
    },

    async applyScanCallback(input: {
      payload: string;
      signature: string | null;
    }): Promise<{ ok: true } | TransferServiceError> {
      if (!scanner?.verifyCallback(input.payload, input.signature)) {
        return { code: "not_found", message: "Transfer not found", status: 404 };
      }
      let body: { handle?: string; verdict?: CleanroomVerdict };
      try {
        body = JSON.parse(input.payload) as { handle?: string; verdict?: CleanroomVerdict };
      } catch {
        return { code: "invalid_request", message: "Request is not usable", status: 400 };
      }
      if (!body.handle || !body.verdict) {
        return { code: "invalid_request", message: "Request is not usable", status: 400 };
      }
      const pointer = await deps.store.lookupScan(body.handle);
      if (!pointer) {
        return { code: "not_found", message: "Transfer not found", status: 404 };
      }
      const transfer = await deps.store.getById(pointer.transferId);
      if (!transfer) {
        return { code: "not_found", message: "Transfer not found", status: 404 };
      }
      const applied = await applyVerdict(transfer, pointer.fileId, body.verdict);
      await finalizeIfScanned(applied);
      return { ok: true };
    },

    async removeFile(input: {
      transferId: string;
      fileId: string;
      publicToken?: string;
    }): Promise<{ ok: true } | TransferServiceError> {
      const transfer = await loadForPublic(input.transferId, input.publicToken);
      if (isTransferServiceError(transfer)) {
        return transfer;
      }
      if (liveStatus(transfer, deps.now()) !== "open") {
        return { code: "closed", message: "Transfer is not accepting files", status: 409 };
      }
      const files = transfer.files ?? [];
      const target = files.find((file) => file.id === input.fileId);
      if (!target) {
        return { code: "not_found", message: "Transfer not found", status: 404 };
      }
      if (
        !(await deps.store.compareAndSave([
          {
            before: transfer,
            after: { ...transfer, files: files.filter((file) => file.id !== input.fileId) },
          },
        ]))
      ) {
        return {
          code: "closed",
          message: "Transfer changed; refresh status and retry",
          status: 409,
        };
      }
      if (target.key && deps.objectStore?.available()) {
        await deps.objectStore.delete(target.key);
      }
      return { ok: true };
    },

    async refreshUploadUrl(input: {
      transferId: string;
      fileId: string;
      publicToken?: string;
      agentToken?: string;
    }): Promise<RefreshUrlResult | TransferServiceError> {
      const transfer = await authorizeFileMutation(input);
      if (isTransferServiceError(transfer)) {
        return transfer;
      }
      if (liveStatus(transfer, deps.now()) !== "open") {
        return { code: "closed", message: "Transfer is not accepting files", status: 409 };
      }
      const store = requireObjectStore(deps.objectStore);
      if (isTransferServiceError(store)) {
        return store;
      }
      const target = (transfer.files ?? []).find((file) => file.id === input.fileId);
      if (!target?.key || target.state !== "pending") {
        return { code: "not_found", message: "Transfer not found", status: 404 };
      }
      if (
        target.uploadExpiresAt &&
        (Date.parse(target.uploadExpiresAt) <= deps.now().getTime() ||
          target.key !== ownedUploadKey(transfer.id, target.id))
      )
        return {
          code: "upload_not_open",
          message: "This upload can no longer be retried",
          status: 409,
        };
      const signed = await store.presignPut({
        key: target.key,
        contentType: target.contentType,
        contentLength: target.size,
        ...(target.uploadExpiresAt
          ? {
              expiresInSeconds: Math.max(
                1,
                Math.floor((Date.parse(target.uploadExpiresAt) - deps.now().getTime()) / 1000),
              ),
            }
          : {}),
      });
      return { uploadUrl: signed.url, expiresAt: signed.expiresAt };
    },
  };
}

export type TransferService = ReturnType<typeof createTransferService>;
