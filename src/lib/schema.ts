import { z } from "zod";

export const DAY_SECONDS = 86_400;
export const TRANSFER_DEFAULT_TTL_SECONDS = 7 * DAY_SECONDS;
export const TRANSFER_MAX_TTL_SECONDS = 30 * DAY_SECONDS;
export const TRANSFER_READ_WINDOW_SECONDS = 3_600;

export const FILE_MAX_BYTES = 5 * 1024 ** 3;
export const FILE_MAX_COUNT = 100;
export const TRANSFER_MAX_BYTES = 20 * 1024 ** 3;
export const SCAN_SIZE_CAP_BYTES = 500 * 1024 * 1024;

export const WAIT_MAX_SECONDS = 60;
export const WAIT_BUDGET_SECONDS = 50;
export const WAIT_FUNCTION_MAX_SECONDS = 60;

export const transferStatuses = [
  "open",
  "scanning",
  "complete",
  "ready",
  "expired",
  "cancelled",
] as const;
export type TransferStatus = (typeof transferStatuses)[number];

export const transferKinds = ["request", "send"] as const;
export type TransferKind = (typeof transferKinds)[number];

export const requestCreateSchema = z.object({
  action: z.literal("request").optional(),
  title: z.string().trim().min(1).max(200),
  message: z.string().trim().max(4_000).optional(),
  expiresInSeconds: z.number().int().positive().max(TRANSFER_MAX_TTL_SECONDS).optional(),
  maxFiles: z.number().int().positive().max(FILE_MAX_COUNT).optional(),
  maxFileSize: z.number().int().positive().max(FILE_MAX_BYTES).optional(),
  allowedTypes: z.array(z.string().trim().min(1).max(127)).max(32).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  callbackUrl: z.string().url().optional(),
});

export type RequestCreateInput = z.infer<typeof requestCreateSchema>;

export const waitSchema = z.object({
  seconds: z.number().int().positive().max(WAIT_MAX_SECONDS).default(WAIT_BUDGET_SECONDS),
});

export const offeredFileSchema = z.object({
  name: z.string().trim().min(1).max(255),
  type: z.string().trim().max(127).optional(),
  size: z.number().int().nonnegative(),
});

export const registerFilesSchema = z.object({
  files: z.array(offeredFileSchema).min(1).max(FILE_MAX_COUNT),
});

export type OfferedFile = z.infer<typeof offeredFileSchema>;

export const sendCreateSchema = z.object({
  action: z.literal("send").optional(),
  title: z.string().trim().min(1).max(200),
  message: z.string().trim().max(4_000).optional(),
  expiresInSeconds: z.number().int().positive().max(TRANSFER_MAX_TTL_SECONDS).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  callbackUrl: z.string().url().optional(),
  files: z.array(offeredFileSchema).min(1).max(FILE_MAX_COUNT),
});

export type SendCreateInput = z.infer<typeof sendCreateSchema>;

export const mergeTransfersSchema = z.object({
  secondaryTransferId: z.string().min(1),
  secondaryAgentToken: z.string().min(1),
});
