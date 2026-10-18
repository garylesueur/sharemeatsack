import { z } from "zod";

export const libraryFileSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  name: z.string(),
  contentType: z.string(),
  size: z.number().int().nonnegative(),
  uploadKey: z.string(),
  objectKey: z.string().optional(),
  createdAt: z.number(),
  uploadExpiresAt: z.number(),
  visible: z.boolean(),
  state: z.enum(["uploading", "sealing", "scanning", "available", "blocked", "removing"]),
  scanAttemptId: z.string().optional(),
  scanHandle: z.string().optional(),
  scanStatus: z.enum(["clean", "skipped-too-large", "infected", "failed"]).optional(),
  scanReason: z.string().optional(),
  references: z.array(z.string()),
  sealDeadlineAt: z.number().optional(),
  cleanupAt: z.number().optional(),
});
export type LibraryFile = z.infer<typeof libraryFileSchema>;
/** Storage-only authority; completed cleanup watches retain no owner/file metadata. */
export const libraryCleanupTargetSchema = libraryFileSchema.pick({
  id: true,
  uploadKey: true,
  objectKey: true,
  scanAttemptId: true,
  uploadExpiresAt: true,
  visible: true,
  state: true,
  references: true,
  sealDeadlineAt: true,
  cleanupAt: true,
});
export type LibraryCleanupTarget = z.infer<typeof libraryCleanupTargetSchema>;
export type LibraryMetadata = {
  call(operation: string, input: Record<string, unknown>): Promise<unknown>;
};
export class LibraryError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}

/** Uses the current server-issued ticket. The Convex service key stays on Lanyard. */
export function createLibraryMetadata(input: {
  origin: string;
  authorization: string;
  fetch?: typeof globalThis.fetch;
}): LibraryMetadata {
  const fetcher = input.fetch ?? globalThis.fetch;
  return {
    async call(operation, args) {
      const response = await fetcher(`${input.origin.replace(/\/$/, "")}/api/v1/library/store`, {
        method: "POST",
        headers: { Authorization: input.authorization, "Content-Type": "application/json" },
        body: JSON.stringify({ ...args, operation }),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        const code =
          result &&
          typeof result === "object" &&
          "error" in result &&
          typeof result.error === "string"
            ? result.error
            : "unavailable";
        throw new LibraryError(code, response.status);
      }
      return result;
    },
  };
}
