import { readR2Config } from "@/lib/object-store";
import { getDefaultObjectStore } from "@/lib/app-transfers";

type RouteContext = {
  params: Promise<{ key: string[] }>;
};

function contentDispositionFilename(filename: string): string {
  const safe = filename.replace(/["\\\r\n]/g, "_").slice(0, 80) || "download";
  return `attachment; filename="${safe}"`;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  if (readR2Config()) {
    return new Response(null, { status: 404 });
  }
  const store = getDefaultObjectStore();
  if (!store) {
    return new Response(null, { status: 503 });
  }
  const { key } = await context.params;
  const objectKey = key.map((part) => decodeURIComponent(part)).join("/");
  const object = await store.get(objectKey);
  if (!object) {
    return new Response(null, { status: 404 });
  }
  const name = new URL(request.url).searchParams.get("name") ?? "download";
  return new Response(Buffer.from(object.body), {
    headers: {
      "content-type": object.contentType,
      "content-disposition": contentDispositionFilename(name),
    },
  });
}

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  if (readR2Config()) {
    return new Response(null, { status: 404 });
  }
  const store = getDefaultObjectStore();
  if (!store) {
    return new Response(null, { status: 503 });
  }
  const { key } = await context.params;
  const objectKey = key.map((part) => decodeURIComponent(part)).join("/");
  const body = new Uint8Array(await request.arrayBuffer());
  const contentType = request.headers.get("content-type") || "application/octet-stream";
  await store.put(objectKey, body, contentType);
  return new Response(null, { status: 204 });
}
