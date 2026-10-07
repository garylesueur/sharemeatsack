import { z } from "zod";
import { PRODUCT_NAME } from "./product";
import {
  FILE_MAX_BYTES,
  FILE_MAX_COUNT,
  TRANSFER_MAX_TTL_SECONDS,
  WAIT_MAX_SECONDS,
} from "./schema";
import {
  isTransferServiceError,
  type TransferService,
  type TransferServiceError,
} from "./transfers";

export const SHAREMEATSACK_TOOL_NAME = PRODUCT_NAME;

export const sharemeatsackToolActions = [
  "request",
  "send",
  "status",
  "wait",
  "cancel",
  "files",
  "merge",
] as const;

export type SharemeatsackToolAction = (typeof sharemeatsackToolActions)[number];

export const sharemeatsackToolInputShape = {
  action: z.enum(sharemeatsackToolActions),
  transferId: z.string().min(1).optional(),
  seconds: z.number().int().positive().max(WAIT_MAX_SECONDS).optional(),
  title: z.string().min(1).optional(),
  message: z.string().optional(),
  expiresInSeconds: z.number().int().positive().max(TRANSFER_MAX_TTL_SECONDS).optional(),
  maxFiles: z.number().int().positive().max(FILE_MAX_COUNT).optional(),
  maxFileSize: z.number().int().positive().max(FILE_MAX_BYTES).optional(),
  allowedTypes: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  callbackUrl: z.string().url().optional(),
  agentToken: z.string().min(1).optional(),
  secondaryTransferId: z.string().min(1).optional(),
  secondaryAgentToken: z.string().min(1).optional(),
  files: z
    .array(
      z.object({
        name: z.string().min(1),
        type: z.string().optional(),
        size: z.number().int().nonnegative(),
      }),
    )
    .optional(),
};

function invalidAction(message: string): TransferServiceError {
  return {
    code: "invalid_action",
    message,
    status: 400,
  };
}

export function createSharemeatsackTool(transfers: TransferService) {
  return {
    name: SHAREMEATSACK_TOOL_NAME,
    async invoke(input: {
      action: SharemeatsackToolAction;
      transferId?: string;
      seconds?: number;
      title?: string;
      message?: string;
      expiresInSeconds?: number;
      maxFiles?: number;
      maxFileSize?: number;
      allowedTypes?: string[];
      metadata?: Record<string, string>;
      callbackUrl?: string;
      agentToken?: string;
      secondaryTransferId?: string;
      secondaryAgentToken?: string;
      files?: { name: string; type?: string; size: number }[];
    }): Promise<unknown> {
      if (input.action === "request") {
        return await transfers.create({
          action: "request",
          title: input.title,
          message: input.message,
          expiresInSeconds: input.expiresInSeconds,
          maxFiles: input.maxFiles,
          maxFileSize: input.maxFileSize,
          allowedTypes: input.allowedTypes,
          metadata: input.metadata,
          callbackUrl: input.callbackUrl,
        });
      }

      if (input.action === "send") {
        return await transfers.create({
          action: "send",
          title: input.title,
          message: input.message,
          expiresInSeconds: input.expiresInSeconds,
          metadata: input.metadata,
          callbackUrl: input.callbackUrl,
          files: input.files,
        });
      }

      if (!input.transferId) {
        return invalidAction("transferId is required");
      }

      if (input.action === "status") {
        return await transfers.getForAgent({
          transferId: input.transferId,
          agentToken: input.agentToken,
        });
      }

      if (input.action === "wait") {
        return await transfers.wait({
          transferId: input.transferId,
          agentToken: input.agentToken,
          seconds: input.seconds,
        });
      }

      if (input.action === "files") {
        return await transfers.listFiles({
          transferId: input.transferId,
          agentToken: input.agentToken,
        });
      }

      if (input.action === "merge") {
        return await transfers.merge({
          transferId: input.transferId,
          agentToken: input.agentToken,
          body: {
            secondaryTransferId: input.secondaryTransferId,
            secondaryAgentToken: input.secondaryAgentToken,
          },
        });
      }

      return await transfers.cancel({
        transferId: input.transferId,
        agentToken: input.agentToken,
      });
    },
  };
}

export function isSharemeatsackToolError(value: unknown): value is TransferServiceError {
  return isTransferServiceError(value);
}
