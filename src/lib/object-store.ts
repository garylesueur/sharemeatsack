import { AwsClient } from "aws4fetch";

export const UPLOAD_URL_TTL_SECONDS = 3_600;

export type ObjectHead = {
  size: number;
};

export type PresignPutInput = {
  key: string;
  contentType: string;
  contentLength: number;
  expiresInSeconds?: number;
};

export type PresignPutResult = {
  url: string;
  expiresAt: string;
};

export const DOWNLOAD_URL_TTL_SECONDS = 15 * 60;

export type PresignGetInput = {
  key: string;
  filename: string;
  contentType?: string;
  expiresInSeconds?: number;
  purpose?: "preview" | "download";
};

export type ObjectReadHeaders = {
  contentType: string;
  contentDisposition: string;
};

export function objectReadHeaders(input: PresignGetInput): ObjectReadHeaders {
  const filename =
    Array.from(input.filename.slice(0, 255))
      .map((char) => {
        const code = char.charCodeAt(0);
        return code < 32 || code === 127 || (char.length === 1 && code >= 0xd800 && code <= 0xdfff)
          ? "_"
          : char;
      })
      .join("") || "download";
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const encoded = encodeURIComponent(filename).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  const offeredType = input.contentType?.split(";", 1)[0]?.trim().toLowerCase();
  const contentType =
    offeredType && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(offeredType)
      ? offeredType
      : "application/octet-stream";
  const activeType = [
    "text/html",
    "application/xhtml+xml",
    "image/svg+xml",
    "application/xml",
    "text/xml",
  ].includes(contentType);
  return {
    contentType: input.purpose === "preview" && activeType ? "text/plain" : contentType,
    contentDisposition: `${input.purpose === "preview" ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encoded}`,
  };
}

export type ObjectStore = {
  available(): boolean;
  presignPut(input: PresignPutInput): Promise<PresignPutResult>;
  presignGet(input: PresignGetInput): Promise<PresignPutResult>;
  head(key: string): Promise<ObjectHead | null>;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ body: Uint8Array; contentType: string } | null>;
  delete(key: string): Promise<void>;
  authorizeRead?(key: string, url: URL): ObjectReadHeaders | null;
};

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string;
};

type EnvMap = Record<string, string | undefined>;

function firstEnv(env: EnvMap, names: string[]): string | undefined {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

export function readR2Config(env: EnvMap = process.env): R2Config | null {
  const accountId = firstEnv(env, ["R2_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID"]);
  const accessKeyId = firstEnv(env, ["R2_ACCESS_KEY_ID"]);
  const secretAccessKey = firstEnv(env, ["R2_SECRET_ACCESS_KEY"]);
  const bucket = firstEnv(env, ["R2_BUCKET_NAME", "R2_BUCKET"]);
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    return null;
  }
  const jurisdiction = firstEnv(env, ["R2_JURISDICTION"]);
  const endpoint =
    firstEnv(env, ["R2_ENDPOINT"]) ??
    (jurisdiction
      ? `https://${accountId}.${jurisdiction}.r2.cloudflarestorage.com`
      : `https://${accountId}.r2.cloudflarestorage.com`);
  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    endpoint: endpoint.replace(/\/$/, ""),
  };
}

function safeSegment(value: string, max: number): string {
  const filtered = value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, max);
  if (filtered === "" || /^\.+$/.test(filtered)) {
    return "_";
  }
  return filtered;
}

export function fileObjectKey(input: {
  transferId: string;
  fileId: string;
  filename: string;
}): string {
  return `sharemeatsack/${safeSegment(input.transferId, 64)}/${safeSegment(input.fileId, 64)}/${safeSegment(input.filename, 80)}`;
}

function r2ObjectUrl(config: R2Config, key: string): string {
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return `${config.endpoint}/${config.bucket}/${encoded}`;
}

function createR2Client(config: R2Config): AwsClient {
  return new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: "auto",
    retries: 3,
  });
}

export function createMemoryObjectStore(now: () => Date = () => new Date()): ObjectStore & {
  objects: Map<string, { body: Uint8Array; contentType: string; size?: number }>;
} {
  const objects = new Map<string, { body: Uint8Array; contentType: string; size?: number }>();
  let issued = 0;
  const reads = new Map<string, { key: string; expires: number; headers: ObjectReadHeaders }>();
  return {
    objects,
    available() {
      return true;
    },
    async presignPut(input) {
      const expiresIn = input.expiresInSeconds ?? UPLOAD_URL_TTL_SECONDS;
      issued += 1;
      const encoded = input.key.split("/").map(encodeURIComponent).join("/");
      return {
        url: `/api/v1/objects/${encoded}?sig=${issued}`,
        expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      };
    },
    async head(key) {
      const object = objects.get(key);
      if (!object) {
        return null;
      }
      return { size: object.size ?? object.body.byteLength };
    },
    async presignGet(input) {
      const expiresIn = input.expiresInSeconds ?? DOWNLOAD_URL_TTL_SECONDS;
      const encoded = input.key.split("/").map(encodeURIComponent).join("/");
      const expires = now().getTime() + expiresIn * 1000;
      for (const [token, grant] of reads) {
        if (grant.expires <= now().getTime()) reads.delete(token);
      }
      const token = crypto.randomUUID();
      reads.set(token, { key: input.key, expires, headers: objectReadHeaders(input) });
      return {
        url: `/api/v1/objects/${encoded}?read=${token}`,
        expiresAt: new Date(expires).toISOString(),
      };
    },
    authorizeRead(key, url) {
      const token = url.searchParams.get("read");
      const grant = token ? reads.get(token) : undefined;
      if (!grant || grant.key !== key || grant.expires <= now().getTime()) return null;
      return grant.headers;
    },
    async put(key, body, contentType) {
      objects.set(key, { body, contentType });
    },
    async get(key) {
      return objects.get(key) ?? null;
    },
    async delete(key) {
      objects.delete(key);
    },
  };
}

export function createR2ObjectStore(
  config: R2Config,
  now: () => Date = () => new Date(),
): ObjectStore {
  const client = createR2Client(config);
  return {
    available() {
      return true;
    },
    async presignPut(input) {
      const expiresIn = input.expiresInSeconds ?? UPLOAD_URL_TTL_SECONDS;
      const target = new URL(r2ObjectUrl(config, input.key));
      target.searchParams.set("X-Amz-Expires", String(expiresIn));
      const signed = await client.sign(
        new Request(target, {
          method: "PUT",
          headers: {
            "Content-Type": input.contentType,
          },
        }),
        {
          aws: { signQuery: true },
        },
      );
      return {
        url: signed.url,
        expiresAt: new Date(now().getTime() + expiresIn * 1000).toISOString(),
      };
    },
    async presignGet(input) {
      const expiresIn = input.expiresInSeconds ?? DOWNLOAD_URL_TTL_SECONDS;
      const target = new URL(r2ObjectUrl(config, input.key));
      target.searchParams.set("X-Amz-Expires", String(expiresIn));
      const headers = objectReadHeaders(input);
      target.searchParams.set("response-content-disposition", headers.contentDisposition);
      target.searchParams.set("response-content-type", headers.contentType);
      target.searchParams.set("response-cache-control", "private, no-store");
      const signed = await client.sign(new Request(target, { method: "GET" }), {
        aws: { signQuery: true },
      });
      return {
        url: signed.url,
        expiresAt: new Date(now().getTime() + expiresIn * 1000).toISOString(),
      };
    },
    async head(key) {
      const response = await client.fetch(r2ObjectUrl(config, key), {
        method: "HEAD",
        headers: { "Accept-Encoding": "identity" },
      });
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error(`Storage metadata is unavailable (${response.status})`);
      }
      const rawLength = response.headers.get("content-length");
      if (!rawLength?.trim()) {
        throw new Error("Storage returned invalid file metadata");
      }
      const length = Number(rawLength);
      if (!Number.isSafeInteger(length) || length < 0) {
        throw new Error("Storage returned invalid file metadata");
      }
      return { size: length };
    },
    async put(key, body, contentType) {
      const payload = new Uint8Array(body.byteLength);
      payload.set(body);
      const response = await client.fetch(r2ObjectUrl(config, key), {
        method: "PUT",
        body: payload.buffer,
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(payload.byteLength),
        },
      });
      if (!response.ok) {
        throw new Error(`R2 refused the upload (${response.status})`);
      }
    },
    async get(key) {
      const response = await client.fetch(r2ObjectUrl(config, key), { method: "GET" });
      if (!response.ok) {
        return null;
      }
      return {
        body: new Uint8Array(await response.arrayBuffer()),
        contentType: response.headers.get("content-type") || "application/octet-stream",
      };
    },
    async delete(key) {
      await client.fetch(r2ObjectUrl(config, key), { method: "DELETE" });
    },
  };
}

export function objectStoreFromEnv(env: EnvMap = process.env): ObjectStore | null {
  const config = readR2Config(env);
  return config ? createR2ObjectStore(config) : null;
}
