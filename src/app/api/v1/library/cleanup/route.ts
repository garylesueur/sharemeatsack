import { z } from "zod";
import { getDefaultObjectStore } from "@/lib/app-transfers";
import { deleteLibraryObjects, verifyLibraryCleanupSignature } from "@/lib/library-cleanup";
import { libraryCleanupTargetSchema } from "@/lib/library-metadata";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const payload = await request.text();
  const signature = request.headers.get("library-cleanup-signature");
  const headers = { "cache-control": "private, no-store" };
  if (
    !verifyLibraryCleanupSignature(payload, signature, process.env.CLEANROOM_WEBHOOK_SECRET ?? "")
  )
    return Response.json({ error: "not_found" }, { status: 404, headers });
  try {
    const { id } = z
      .object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) })
      .strict()
      .parse(JSON.parse(payload));
    // The shared scanner secret alone grants no purge authority. Recheck the
    // durable tombstone/reference/deadline state on Lanyard before touching bytes.
    const response = await fetch(
      new URL(
        "/api/v1/library/cleanup-authorization",
        process.env.LANYARD_URL ?? "https://meatsack.puregaz.com",
      ),
      {
        method: "POST",
        body: payload,
        headers: { "Content-Type": "application/json", "library-cleanup-signature": signature! },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok) throw new Error("Cleanup authorization unavailable");
    const result = z
      .object({ ok: z.literal(true), file: libraryCleanupTargetSchema.nullable() })
      .parse(await response.json());
    if (!result.file) return Response.json({ ok: false }, { status: 409, headers });
    if (result.file.id !== id) throw new Error("Wrong cleanup record");
    const objects = getDefaultObjectStore();
    if (!objects?.available() || !(await deleteLibraryObjects(result.file, objects, Date.now())))
      throw new Error("Deletion unconfirmed");
    return Response.json({ ok: true }, { headers });
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503, headers });
  }
}
