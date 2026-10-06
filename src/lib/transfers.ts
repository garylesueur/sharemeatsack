import {
  createMemoryCleanroom,
  isTakeableScan,
  isTerminalScan,
  SCAN_LINK_TTL_SECONDS,
  scanStatusFromVerdict,
  type Cleanroom,
  type CleanroomVerdict,
} from "./cleanroom";
import { manageMarkdown } from "./manage-markdown";
import { fileObjectKey, type ObjectStore } from "./object-store";
import { publicOrigin } from "./public-origin";
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
  waitSchema,
  type TransferStatus,
} from "./schema";
import { createId, createToken, tokensMatch } from "./tokens";
import type { Transfer, TransferFile, TransferStore } from "./transfer-store";

const WAIT_POLL_MS = 400;

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
};

export function defaultTransferServiceDeps(
  store: TransferStore,
  objectStore?: ObjectStore | null,
  scanner?: Cleanroom | null,
): TransferServiceDeps {
  return {
    store,
    now: () => new Date(),
    createId,
    createToken,
    objectStore,
    scanner,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
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
    if (isTakeableScan(scanStatus) && file.key && deps.objectStore?.available()) {
      const signed = await deps.objectStore.presignGet({
        key: file.key,
        filename: file.filename,
        contentType: file.contentType,
      });
      item.downloadUrl = signed.url;
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
  await deps.store.save({ ...transfer, callbackSent: true });
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

export function createTransferService(deps: TransferServiceDeps) {
  const scanner = deps.scanner === undefined ? createMemoryCleanroom() : deps.scanner;

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
    return `${publicOrigin()}/api/v1/scans/callback`;
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
  ): Promise<Transfer> {
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
    if (verdict.verdict === "infected" && target?.key && deps.objectStore?.available()) {
      await deps.objectStore.delete(target.key);
    }
    const next = { ...transfer, files };
    await deps.store.save(next);
    return next;
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
      await deps.store.save(next);
      await markCallbackAttempted(deps, next);
      return next;
    }
    const next: Transfer = {
      ...transfer,
      status: transfer.kind === "send" ? "ready" : "complete",
      completedAt: deps.now().toISOString(),
    };
    await deps.store.save(next);
    await markCallbackAttempted(deps, next);
    return next;
  }

  async function submitScans(transfer: Transfer): Promise<Transfer> {
    const store = deps.objectStore;
    let current = transfer;
    const files = [...(current.files ?? [])];
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
        await deps.store.indexScan(submitted.handle, { transferId: current.id, fileId: file.id });
        if (submitted.verdict?.verdict === "infected") {
          await store.delete(file.key);
        }
      } catch {
        files[index] = { ...file, scanStatus: "failed", scanReason: "submit failed" };
      }
    }
    current = { ...current, files };
    await deps.store.save(current);
    return await finalizeIfScanned(current);
  }

  async function arriveAndScan(transfer: Transfer): Promise<Transfer> {
    const current = liveStatus(transfer, deps.now());
    if (current !== "open") {
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
    const accepted: TransferFile[] = [];
    for (const file of pending) {
      if (!file.key) {
        return transfer;
      }
      const head = await store.head(file.key);
      if (!head || head.size !== file.size) {
        return transfer;
      }
      accepted.push({ ...file, state: "accepted", scanStatus: file.scanStatus ?? "scanning" });
    }
    const next: Transfer = {
      ...transfer,
      status: "scanning",
      files: accepted,
    };
    await deps.store.save(next);
    return await submitScans(next);
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
        current = await applyVerdict(current, file.id, polled.verdict);
      }
    }
    return await submitScans(current);
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
    async createRequest(body: unknown): Promise<CreateRequestResult | TransferServiceError> {
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
      await deps.store.save(transfer);
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

    async createSend(body: unknown): Promise<CreateSendResult | TransferServiceError> {
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
        const key = fileObjectKey({ transferId: id, fileId, filename: file.name });
        const signed = await store.presignPut({
          key,
          contentType,
          contentLength: file.size,
        });
        files.push({
          id: fileId,
          filename: file.name,
          contentType,
          size: file.size,
          key,
          state: "pending",
        });
        registered.push({
          id: fileId,
          name: file.name,
          size: file.size,
          type: contentType,
          uploadUrl: signed.url,
          expiresAt: signed.expiresAt,
        });
      }
      const transfer: Transfer = {
        id,
        kind: "send",
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
      await deps.store.save(transfer);
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
    ): Promise<CreateRequestResult | CreateSendResult | TransferServiceError> {
      const action =
        body && typeof body === "object" && "action" in body
          ? (body as { action?: unknown }).action
          : "request";
      if (action === "send") {
        return await this.createSend(body);
      }
      return await this.createRequest(body);
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
      const transfer = await refreshScans(loaded);
      const view = publicView(transfer);
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
          if (file.state !== "accepted" || !file.key || !isTakeableScan(file.scanStatus)) {
            continue;
          }
          const signed = await deps.objectStore.presignGet({
            key: file.key,
            filename: file.filename,
            contentType: file.contentType,
          });
          files.push({
            id: file.id,
            name: file.filename,
            size: file.size,
            type: file.contentType,
            state: file.state,
            scanStatus: file.scanStatus,
            downloadUrl: signed.url,
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
      await deps.store.save(next);
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
      const existing = latest.files ?? [];
      const offered = parsed.data.files;
      const cap = fileCaps(latest);
      const refusal = refuseOfferedFiles(existing, offered, cap);
      if (refusal) {
        return refusal;
      }

      const mintId = deps.createFileId ?? deps.createId;
      const registered: RegisteredFile[] = [];
      const nextFiles = [...existing];
      for (const file of offered) {
        const contentType = file.type?.trim() || "application/octet-stream";
        const id = mintId();
        const key = fileObjectKey({
          transferId: latest.id,
          fileId: id,
          filename: file.name,
        });
        const signed = await store.presignPut({
          key,
          contentType,
          contentLength: file.size,
        });
        nextFiles.push({
          id,
          filename: file.name,
          contentType,
          size: file.size,
          key,
          state: "pending",
        });
        registered.push({
          id,
          name: file.name,
          size: file.size,
          type: contentType,
          uploadUrl: signed.url,
          expiresAt: signed.expiresAt,
        });
      }
      await deps.store.save({ ...latest, files: nextFiles });
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
      if (target.key && deps.objectStore?.available()) {
        await deps.objectStore.delete(target.key);
      }
      await deps.store.save({
        ...transfer,
        files: files.filter((file) => file.id !== input.fileId),
      });
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
      const signed = await store.presignPut({
        key: target.key,
        contentType: target.contentType,
        contentLength: target.size,
      });
      return { uploadUrl: signed.url, expiresAt: signed.expiresAt };
    },
  };
}

export type TransferService = ReturnType<typeof createTransferService>;
