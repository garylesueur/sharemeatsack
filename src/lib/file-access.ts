export type FileAccess = { transferId: string; token: string };
export type ReadPurpose = "preview" | "download";
export type ReadUrl = { url: string; expiresAt: string };

export class FileAccessError extends Error {
  constructor(public status: number) {
    super(
      status === 404 || status === 401 || status === 403
        ? "This file is no longer available through this link."
        : "The file could not be reached. Try again.",
    );
  }
  get denied() {
    return [401, 403, 404].includes(this.status);
  }
}

export function createReadResolver(
  access: FileAccess,
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
) {
  const cache = new Map<string, ReadUrl>();
  const pending = new Map<string, Promise<ReadUrl>>();
  return {
    clear(fileId: string) {
      cache.delete(`preview:${fileId}`);
      cache.delete(`download:${fileId}`);
    },
    async resolve(fileId: string, purpose: ReadPurpose, force = false): Promise<ReadUrl> {
      const key = `${purpose}:${fileId}`;
      const cached = cache.get(key);
      if (!force && cached && Date.parse(cached.expiresAt) - now() > 30_000) return cached;
      const existing = pending.get(key);
      if (existing) return existing;
      const request = (async () => {
        const response = await fetcher(
          `/api/v1/transfers/${encodeURIComponent(access.transferId)}/files/${encodeURIComponent(fileId)}/read-url`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${access.token}`,
            },
            body: JSON.stringify({ purpose }),
            cache: "no-store",
            signal: AbortSignal.timeout(30_000),
          },
        );
        if (!response.ok) throw new FileAccessError(response.status);
        const data: unknown = await response.json();
        if (
          !data ||
          typeof data !== "object" ||
          !("url" in data) ||
          !("expiresAt" in data) ||
          typeof data.url !== "string" ||
          typeof data.expiresAt !== "string" ||
          !Number.isFinite(Date.parse(data.expiresAt))
        )
          throw new FileAccessError(502);
        const parsed = new URL(data.url, "https://sharemeatsack.com");
        if (!["https:", "http:"].includes(parsed.protocol)) throw new FileAccessError(502);
        const result = { url: data.url, expiresAt: data.expiresAt };
        cache.set(key, result);
        return result;
      })();
      pending.set(key, request);
      try {
        return await request;
      } finally {
        pending.delete(key);
      }
    },
  };
}

export type ReadResolver = ReturnType<typeof createReadResolver>;
