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
};

export type ObjectStore = {
  available(): boolean;
  presignPut(input: PresignPutInput): Promise<PresignPutResult>;
  presignGet(input: PresignGetInput): Promise<PresignPutResult>;
  head(key: string): Promise<ObjectHead | null>;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ body: Uint8Array; contentType: string } | null>;
  delete(key: string): Promise<void>;
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

export function createMemoryObjectStore(): ObjectStore & {
  objects: Map<string, { body: Uint8Array; contentType: string; size?: number }>;
} {
  const objects = new Map<string, { body: Uint8Array; contentType: string; size?: number }>();
  let issued = 0;
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
      issued += 1;
      const encoded = input.key.split("/").map(encodeURIComponent).join("/");
      return {
        url: `/api/v1/objects/${encoded}?download=1&name=${encodeURIComponent(input.filename)}&sig=${issued}`,
        expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      };
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
      const signed = await client.sign(new Request(target, { method: "GET" }), {
        aws: { signQuery: true },
      });
      return {
        url: signed.url,
        expiresAt: new Date(now().getTime() + expiresIn * 1000).toISOString(),
      };
    },
    async head(key) {
      const response = await client.fetch(r2ObjectUrl(config, key), { method: "HEAD" });
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        return null;
      }
      const length = Number(response.headers.get("content-length") ?? "");
      if (!Number.isFinite(length)) {
        return null;
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
