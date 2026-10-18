import { AwsClient } from "aws4fetch";

export const UPLOAD_URL_TTL_SECONDS = 3_600;

export type ObjectHead = {
  size: number;
};

/** Provider object identity, not a content checksum. */
export type ObjectVersion = ObjectHead & { version: string };

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
  /** Claims bind scan results to a uniquely elected immutable destination. */
  headVersion?(key: string): Promise<ObjectVersion | null>;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ body: Uint8Array; contentType: string } | null>;
  /** Storage copies bytes internally; upload capabilities never target the sealed key. */
  copy(sourceKey: string, targetKey: string): Promise<void>;
  /** Atomic provider copy conditional on the exact source observed before admission. */
  copyVersion?(sourceKey: string, targetKey: string, expected: ObjectVersion): Promise<void>;
  delete(key: string): Promise<void>;
  authorizeRead?(key: string, url: URL): ObjectReadHeaders | null;
  authorizePut?(key: string, url: URL): { size: number; contentType: string } | null;
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
  const versions = new WeakMap<object, string>();
  const reads = new Map<string, { key: string; expires: number; headers: ObjectReadHeaders }>();
  const writes = new Map<
    string,
    { key: string; expires: number; size: number; contentType: string }
  >();
  return {
    objects,
    available() {
      return true;
    },
    async presignPut(input) {
      const expiresIn = input.expiresInSeconds ?? UPLOAD_URL_TTL_SECONDS;
      issued += 1;
      const encoded = input.key.split("/").map(encodeURIComponent).join("/");
      const expires = now().getTime() + expiresIn * 1000;
      const owned = input.key.startsWith("sharemeatsack/owned/");
      if (input.key.startsWith("sharemeatsack/library/") || owned) {
        if (
          !/^sharemeatsack\/library\/[A-Za-z0-9_-]+\/upload$/.test(input.key) &&
          !/^sharemeatsack\/owned\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/upload$/.test(input.key)
        )
          throw new Error(
            owned ? "Owned upload must target staging" : "Library upload must target staging",
          );
        for (const [token, grant] of writes)
          if (grant.expires <= now().getTime()) writes.delete(token);
        const token = crypto.randomUUID();
        writes.set(token, {
          key: input.key,
          expires,
          size: input.contentLength,
          contentType: input.contentType,
        });
        return {
          url: `/api/v1/objects/${encoded}?write=${token}`,
          expiresAt: new Date(expires).toISOString(),
        };
      }
      return {
        url: `/api/v1/objects/${encoded}?sig=${issued}`,
        expiresAt: new Date(expires).toISOString(),
      };
    },
    authorizePut(key, url) {
      const token = url.searchParams.get("write");
      const grant = token ? writes.get(token) : undefined;
      if (!grant || grant.key !== key || grant.expires <= now().getTime()) return null;
      return { size: grant.size, contentType: grant.contentType };
    },
    async head(key) {
      const object = objects.get(key);
      if (!object) {
        return null;
      }
      return { size: object.size ?? object.body.byteLength };
    },
    async headVersion(key) {
      const object = objects.get(key);
      if (!object) return null;
      let version = versions.get(object);
      if (!version) {
        version = crypto.randomUUID();
        versions.set(object, version);
      }
      return { size: object.size ?? object.body.byteLength, version };
    },
    async copy(sourceKey, targetKey) {
      if (sourceKey === targetKey) throw new Error("A sealed copy needs a separate key");
      const source = objects.get(sourceKey);
      if (!source) throw new Error("The uploaded object is unavailable");
      objects.set(targetKey, {
        body: new Uint8Array(source.body),
        contentType: source.contentType,
        ...(source.size !== undefined ? { size: source.size } : {}),
      });
    },
    async copyVersion(sourceKey, targetKey, expected) {
      if (sourceKey === targetKey) throw new Error("A sealed copy needs a separate key");
      const source = objects.get(sourceKey);
      if (
        !source ||
        versions.get(source) !== expected.version ||
        (source.size ?? source.body.byteLength) !== expected.size
      )
        throw new Error("The source object changed before copying");
      objects.set(targetKey, {
        body: new Uint8Array(source.body),
        contentType: source.contentType,
        ...(source.size !== undefined ? { size: source.size } : {}),
      });
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
  async function copy(sourceKey: string, targetKey: string, expected?: ObjectVersion) {
    if (sourceKey === targetKey) throw new Error("A sealed copy needs a separate key");
    const source = [config.bucket, ...sourceKey.split("/")].map(encodeURIComponent).join("/");
    const response = await client.fetch(r2ObjectUrl(config, targetKey), {
      method: "PUT",
      headers: {
        "x-amz-copy-source": `/${source}`,
        ...(expected ? { "x-amz-copy-source-if-match": expected.version } : {}),
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status !== 200)
      throw new Error(`Storage could not seal the upload (${response.status})`);
    // An S3 COPY can carry an embedded error with HTTP 200. The caller also verifies the sealed HEAD.
    const result = await response.text();
    if (
      !/<CopyObjectResult(?:\s|>)/.test(result) ||
      !result.includes("</CopyObjectResult>") ||
      /<Error(?:\s|>)/.test(result)
    )
      throw new Error("Storage did not confirm the sealed copy");
  }
  return {
    available() {
      return true;
    },
    async presignPut(input) {
      const expiresIn = input.expiresInSeconds ?? UPLOAD_URL_TTL_SECONDS;
      const library = input.key.startsWith("sharemeatsack/library/");
      const owned = input.key.startsWith("sharemeatsack/owned/");
      if (
        owned &&
        !/^sharemeatsack\/owned\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/upload$/.test(input.key)
      )
        throw new Error("Owned upload must target staging");
      const constrained = library || owned;
      const target = new URL(r2ObjectUrl(config, input.key));
      target.searchParams.set("X-Amz-Expires", String(expiresIn));
      const signed = await client.sign(
        new Request(target, {
          method: "PUT",
          headers: {
            "Content-Type": input.contentType,
            ...(constrained ? { "Content-Length": String(input.contentLength) } : {}),
          },
        }),
        {
          aws: { signQuery: true, allHeaders: constrained },
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
    async headVersion(key) {
      const response = await client.fetch(r2ObjectUrl(config, key), {
        method: "HEAD",
        headers: { "Accept-Encoding": "identity" },
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error("Storage object identity is unavailable");
      const rawLength = response.headers.get("content-length");
      const size = rawLength?.trim() ? Number(rawLength) : NaN;
      const version = response.headers.get("etag");
      if (
        !Number.isSafeInteger(size) ||
        size < 0 ||
        !version ||
        version.length > 256 ||
        !/^"[\x21\x23-\x7e]+"$/.test(version)
      )
        throw new Error("Storage returned invalid object identity");
      return { size, version };
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
    copy,
    async copyVersion(sourceKey, targetKey, expected) {
      if (
        !Number.isSafeInteger(expected.size) ||
        expected.size < 0 ||
        !/^"[\x21\x23-\x7e]+"$/.test(expected.version) ||
        expected.version.length > 256
      )
        throw new Error("Invalid observed source identity");
      return copy(sourceKey, targetKey, expected);
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
