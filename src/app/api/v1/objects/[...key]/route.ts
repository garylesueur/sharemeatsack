import { readR2Config } from "@/lib/object-store";
import { getDefaultObjectStore } from "@/lib/app-transfers";

type RouteContext = {
  params: Promise<{ key: string[] }>;
};

function byteRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || size === 0) return null;
  const first = match[1] ? Number(match[1]) : undefined;
  const last = match[2] ? Number(match[2]) : undefined;
  if (
    (first !== undefined && !Number.isSafeInteger(first)) ||
    (last !== undefined && !Number.isSafeInteger(last))
  )
    return null;
  if (first === undefined) {
    if (!last || last <= 0) return null;
    return { start: Math.max(0, size - last), end: size - 1 };
  }
  if (first >= size || (last !== undefined && last < first)) return null;
  return { start: first, end: Math.min(last ?? size - 1, size - 1) };
}

async function read(request: Request, context: RouteContext, head: boolean): Promise<Response> {
  const baseHeaders = { "cache-control": "private, no-store" };
  if (readR2Config()) return new Response(null, { status: 404, headers: baseHeaders });
  const store = getDefaultObjectStore();
  if (!store) return new Response(null, { status: 503, headers: baseHeaders });
  const { key } = await context.params;
  const objectKey = key.join("/");
  const grant = store.authorizeRead?.(objectKey, new URL(request.url));
  if (!grant) return new Response(null, { status: 404, headers: baseHeaders });
  const object = await store.get(objectKey);
  if (!object) return new Response(null, { status: 404, headers: baseHeaders });
  const headers = new Headers({
    ...baseHeaders,
    "content-type": grant.contentType,
    "content-disposition": grant.contentDisposition,
    "x-content-type-options": "nosniff",
    "content-security-policy": "sandbox; default-src 'none'; frame-ancestors 'none'",
    "accept-ranges": "bytes",
    "content-length": String(object.body.byteLength),
  });
  const rangeHeader = request.headers.get("range");
  // HEAD describes the complete representation, as it does at storage.
  if (!head && rangeHeader) {
    const range = byteRange(rangeHeader, object.body.byteLength);
    if (!range) {
      headers.set("content-range", `bytes */${object.body.byteLength}`);
      headers.set("content-length", "0");
      return new Response(null, { status: 416, headers });
    }
    headers.set("content-range", `bytes ${range.start}-${range.end}/${object.body.byteLength}`);
    headers.set("content-length", String(range.end - range.start + 1));
    return new Response(Buffer.from(object.body.subarray(range.start, range.end + 1)), {
      status: 206,
      headers,
    });
  }
  return new Response(head ? null : Buffer.from(object.body), { headers });
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return read(request, context, false);
}

export async function HEAD(request: Request, context: RouteContext): Promise<Response> {
  return read(request, context, true);
}

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  if (readR2Config()) return new Response(null, { status: 404 });
  const store = getDefaultObjectStore();
  if (!store) return new Response(null, { status: 503 });
  const { key } = await context.params;
  const objectKey = key.join("/");
  const body = new Uint8Array(await request.arrayBuffer());
  const contentType = request.headers.get("content-type") || "application/octet-stream";
  await store.put(objectKey, body, contentType);
  return new Response(null, { status: 204 });
}
