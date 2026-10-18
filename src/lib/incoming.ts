import { randomUUID } from "node:crypto";
import { z } from "zod";
import { libraryFileSchema, type LibraryMetadata } from "./library-metadata";
import { libraryFileView } from "./library";
import type { ObjectStore } from "./object-store";
import { OwnedTransferError } from "./owned-transfer-metadata";
import { publicTransferShareUrl } from "./public-sharing";
import {
  isTransferServiceError,
  type PublicTransferView,
  type TransferServiceError,
} from "./transfers";
import type { Transfer, TransferStore } from "./transfer-store";

const identity = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const referenceSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().min(1).max(256),
  transferId: identity,
  publicToken: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/),
  kind: z.enum(["request", "send"]),
  title: z.string().max(255),
  savedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
});
type IncomingReference = z.infer<typeof referenceSchema>;
const keepingSchema = z.object({ id: z.string().uuid() }).strict();
const urlSchema = z.object({ url: z.string().min(1).max(1024) }).strict();
const saveSchema = urlSchema.extend({ id: z.string().uuid() }).strict();
const keptSchema = z.object({
  keptFiles: z.record(identity, z.string().uuid()),
  files: z
    .array(
      z.object({
        id: identity,
        keptLibraryId: z.string().uuid(),
        name: z.string().max(255),
        type: z.string().max(255),
        size: z.number().int().nonnegative(),
        scanStatus: z.string().max(64).optional(),
      }),
    )
    .max(100)
    .optional(),
});
function serverValue<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new OwnedTransferError("unavailable", 503);
  return result.data;
}

/** Exact product recipient URLs only. This value is never used as a fetch destination. */
export function parseIncomingUrl(value: string, origins: string[]) {
  try {
    const url = new URL(value);
    const allowed = origins.some((origin) => {
      const base = new URL(origin);
      return (
        base.origin === url.origin &&
        base.pathname === "/" &&
        !base.search &&
        !base.hash &&
        !base.username &&
        !base.password
      );
    });
    const match = /^\/s\/([A-Za-z0-9_-]{1,128})$/.exec(url.pathname);
    const token = url.searchParams.get("t") ?? "";
    if (
      !allowed ||
      !match ||
      url.username ||
      url.password ||
      url.hash ||
      value.length > 1024 ||
      publicTransferShareUrl(url.origin, match[1], token) !== value
    )
      throw new Error("Invalid recipient URL");
    return { transferId: match[1], publicToken: token, url: value };
  } catch {
    throw new OwnedTransferError("invalid_url", 400);
  }
}

export type IncomingFileView = {
  id: string;
  name: string;
  type: string;
  size: number;
  scanStatus?: string;
  canRead: boolean;
  canKeep: boolean;
  keptLibraryId?: string;
};
export type IncomingView = {
  id: string;
  transferId: string;
  kind: "request" | "send";
  title: string;
  savedAt: string;
  expiresAt: string;
  status: string;
  role: "download" | "upload";
  available: boolean;
  canKeep: boolean;
  files: IncomingFileView[];
  message?: string;
  keepUnavailableReason?: "legacy_source";
};

function usable(view: Pick<PublicTransferView, "kind" | "status"> | null) {
  return !!view && (view.kind === "send" ? view.status === "ready" : view.status === "open");
}

export function createIncomingService(deps: {
  accountId: string;
  metadata: LibraryMetadata;
  objects: ObjectStore | null;
  origins: string[];
  store: TransferStore;
  transfers: {
    loadForPublic(
      transferId: string,
      publicToken: string,
    ): Promise<Transfer | TransferServiceError>;
    getForPublic(input: {
      transferId: string;
      publicToken: string;
    }): Promise<PublicTransferView | TransferServiceError>;
  };
}) {
  function owned(value: unknown) {
    const parsed = referenceSchema.safeParse(value);
    if (!parsed.success) throw new OwnedTransferError("unavailable", 503);
    if (parsed.data.accountId !== deps.accountId) throw new OwnedTransferError("not_found", 404);
    return parsed.data;
  }
  async function reference(id: string) {
    const value = await deps.metadata.call("getIncoming", { accountId: deps.accountId, id });
    if (value === null) throw new OwnedTransferError("not_found", 404);
    const result = owned(value);
    if (result.id !== id) throw new OwnedTransferError("unavailable", 503);
    return result;
  }
  async function source(binding: { transferId: string; publicToken: string }) {
    const view = await deps.transfers.getForPublic(binding);
    if (isTransferServiceError(view)) {
      if (view.code === "not_found") return null;
      throw new OwnedTransferError("unavailable", 503);
    }
    if (view.transferId !== binding.transferId) throw new OwnedTransferError("unavailable", 503);
    return view;
  }
  async function project(row: IncomingReference): Promise<IncomingView> {
    const view = await source(row);
    if (view && view.kind !== row.kind) throw new OwnedTransferError("unavailable", 503);
    const available = usable(view);
    // A missing authority is an unavailable reference; infrastructure failures propagate.
    const durable =
      view && row.kind === "send" ? (await deps.store.fileAccess?.(row.transferId)) != null : false;
    const associations =
      row.kind === "send"
        ? serverValue(
            keptSchema,
            await deps.metadata.call("incomingKeptFiles", {
              accountId: deps.accountId,
              id: row.id,
            }),
          )
        : { keptFiles: {} as Record<string, string>, files: [] };
    if (Object.keys(associations.keptFiles).length > 100)
      throw new OwnedTransferError("unavailable", 503);
    const files: IncomingFileView[] =
      row.kind === "send" && available && view
        ? view.files.map((file) => ({
            id: file.id,
            name: file.name,
            type: file.type,
            size: file.size,
            ...(file.scanStatus ? { scanStatus: file.scanStatus } : {}),
            canRead: !!file.downloadUrl,
            canKeep: !!file.downloadUrl && durable && !associations.keptFiles[file.id],
            ...(associations.keptFiles[file.id]
              ? { keptLibraryId: associations.keptFiles[file.id] }
              : {}),
          }))
        : [];
    // Available independent copies remain discoverable when original recipient access ends.
    for (const file of associations.files ?? []) {
      if (
        associations.keptFiles[file.id] !== file.keptLibraryId ||
        files.some((item) => item.id === file.id)
      )
        continue;
      files.push({ ...file, canRead: false, canKeep: false });
    }
    return {
      id: row.id,
      transferId: row.transferId,
      kind: row.kind,
      title: view?.title ?? row.title,
      savedAt: new Date(row.savedAt).toISOString(),
      expiresAt: view?.expiresAt ?? new Date(row.expiresAt).toISOString(),
      status: view?.status ?? "unavailable",
      role: row.kind === "send" ? "download" : "upload",
      available,
      canKeep: files.some((file) => file.canKeep),
      files,
      ...(view?.message ? { message: view.message.slice(0, 4000) } : {}),
      ...(view && row.kind === "send" && !durable
        ? { keepUnavailableReason: "legacy_source" as const }
        : {}),
    };
  }
  return {
    async resolve(body: unknown) {
      const { url } = urlSchema.parse(body);
      const binding = parseIncomingUrl(url, deps.origins);
      // Review needs live recipient authority only. Avoid scan-refreshing reads,
      // incoming metadata writes and event capture before explicit confirmation.
      const view = await deps.transfers.loadForPublic(binding.transferId, binding.publicToken);
      if (isTransferServiceError(view)) {
        if (view.code === "not_found") throw new OwnedTransferError("source_unavailable", 409);
        throw new OwnedTransferError("unavailable", 503);
      }
      if (view.id !== binding.transferId) throw new OwnedTransferError("unavailable", 503);
      if (!usable(view)) throw new OwnedTransferError("source_unavailable", 409);
      return {
        transferId: view.id,
        kind: view.kind,
        title: view.title,
        expiresAt: view.expiresAt,
        status: view.status,
        role: view.kind === "send" ? ("download" as const) : ("upload" as const),
        available: true as const,
      };
    },
    async save(body: unknown) {
      const { id, url } = saveSchema.parse(body);
      const binding = parseIncomingUrl(url, deps.origins);
      // A retry of an already saved reference survives later source loss.
      const existing = await deps.metadata.call("getIncoming", { accountId: deps.accountId, id });
      if (existing !== null) {
        const row = owned(existing);
        if (
          row.id !== id ||
          row.transferId !== binding.transferId ||
          row.publicToken !== binding.publicToken
        )
          throw new OwnedTransferError("conflict", 409);
        return project(row);
      }
      const view = await source(binding);
      if (!usable(view)) throw new OwnedTransferError("source_unavailable", 409);
      const result = await deps.metadata.call("saveIncoming", {
        accountId: deps.accountId,
        id,
        transferId: binding.transferId,
        publicToken: binding.publicToken,
        kind: view!.kind,
        title: view!.title,
        expiresAt: Date.parse(view!.expiresAt),
      });
      if (result === null) throw new OwnedTransferError("source_unavailable", 409);
      const row = owned(result);
      if (row.transferId !== binding.transferId || row.publicToken !== binding.publicToken)
        throw new OwnedTransferError("unavailable", 503);
      return project(row);
    },
    async list(page: { limit: number; cursor: string | null }) {
      const parsed = serverValue(
        z.object({
          records: z.array(referenceSchema).max(page.limit),
          nextCursor: z.string().max(4096).nullable().optional(),
        }),
        await deps.metadata.call("listIncoming", { accountId: deps.accountId, ...page }),
      );
      const records = await Promise.all(parsed.records.map((row) => project(owned(row))));
      return { records, ...(parsed.nextCursor ? { nextCursor: parsed.nextCursor } : {}) };
    },
    async get(id: string) {
      return project(await reference(id));
    },
    async remove(id: string) {
      const result = await deps.metadata.call("removeIncoming", { accountId: deps.accountId, id });
      if (result !== true && result !== false) throw new OwnedTransferError("unavailable", 503);
      return { removed: true };
    },
    async open(id: string) {
      const row = await reference(id);
      if (!usable(await source(row))) throw new OwnedTransferError("source_unavailable", 409);
      const url = publicTransferShareUrl(deps.origins[0], row.transferId, row.publicToken);
      if (!url) throw new OwnedTransferError("unavailable", 503);
      return { url };
    },
    async keep(incomingId: string, fileId: string, body: unknown) {
      const { id } = keepingSchema.parse(body);
      if (!deps.objects?.available()) throw new OwnedTransferError("unavailable", 503);
      const binding = { accountId: deps.accountId, incomingId, fileId };
      const reservation = await deps.metadata.call("beginIncomingKeep", {
        ...binding,
        id,
        attemptId: randomUUID(),
      });
      if (reservation === null) throw new OwnedTransferError("file_unavailable", 409);
      const copy = serverValue(
        z.object({
          file: libraryFileSchema,
          sourceKey: z.string(),
          status: z.enum(["copying", "kept"]),
        }),
        reservation,
      );
      const target = copy.file;
      if (target.accountId !== deps.accountId) throw new OwnedTransferError("not_found", 404);
      if (copy.status === "kept") {
        if (!target.visible || target.state !== "available")
          throw new OwnedTransferError("unavailable", 503);
        return { file: libraryFileView(target), status: "kept" as const };
      }
      const expectedKey = `sharemeatsack/library/${target.id}/sealed/${target.scanAttemptId}`;
      if (
        !target.scanAttemptId ||
        target.objectKey !== expectedKey ||
        target.state !== "sealing" ||
        target.visible ||
        !/^sharemeatsack\/(?:owned\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+|library\/[A-Za-z0-9_-]+)\/sealed\/[A-Za-z0-9_-]+$/.test(
          copy.sourceKey,
        )
      )
        throw new OwnedTransferError("unavailable", 503);
      await deps.objects.copy(copy.sourceKey, target.objectKey);
      const head = await deps.objects.head(target.objectKey);
      if (!head || head.size !== target.size) {
        await deps.metadata.call("abortIncomingKeep", { ...binding, id: target.id });
        throw new OwnedTransferError("file_unavailable", 409);
      }
      const committed = await deps.metadata.call("commitIncomingKeep", {
        ...binding,
        id: target.id,
        attemptId: target.scanAttemptId,
        observedBytes: head.size,
      });
      if (committed === null) throw new OwnedTransferError("file_unavailable", 409);
      const file = serverValue(libraryFileSchema, committed);
      if (
        file.accountId !== deps.accountId ||
        file.id !== target.id ||
        !file.visible ||
        file.state !== "available"
      )
        throw new OwnedTransferError("file_unavailable", 409);
      return { file: libraryFileView(file), status: "kept" as const };
    },
    async abortKeep(incomingId: string, fileId: string, body: unknown) {
      const { id } = keepingSchema.parse(body);
      const result = await deps.metadata.call("abortIncomingKeep", {
        accountId: deps.accountId,
        incomingId,
        fileId,
        id,
      });
      if (result === null) return { state: "stopped" as const };
      const parsed = serverValue(
        z.object({ file: libraryFileSchema, status: z.enum(["kept", "cleaning"]) }),
        result,
      );
      if (parsed.file.accountId !== deps.accountId) throw new OwnedTransferError("not_found", 404);
      if (parsed.status === "kept" && (!parsed.file.visible || parsed.file.state !== "available"))
        throw new OwnedTransferError("unavailable", 503);
      return parsed.status === "kept"
        ? { state: "kept" as const, file: libraryFileView(parsed.file) }
        : { state: "cleanup-pending" as const };
    },
  };
}
