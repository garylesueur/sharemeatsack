import { verifyCleanroomSignature } from "@/lib/cleanroom";
import { getDefaultObjectStore } from "@/lib/app-transfers";
import { libraryFileSchema } from "@/lib/library-metadata";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request): Promise<Response> {
  const payload = await request.text();
  const signature = request.headers.get("cleanroom-signature");
  const headers = { "cache-control": "private, no-store" };
  if (
    !verifyCleanroomSignature({
      payload,
      header: signature,
      secret: process.env.CLEANROOM_WEBHOOK_SECRET ?? "",
    })
  )
    return Response.json({ error: "not_found" }, { status: 404, headers });
  try {
    const origin = process.env.LANYARD_URL ?? "https://meatsack.puregaz.com";
    const response = await fetch(new URL("/api/v1/library/scan-result", origin), {
      method: "POST",
      body: payload,
      headers: { "cleanroom-signature": signature!, "Content-Type": "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error("Metadata could not record the scan");
    const result: unknown = await response.json();
    const stored = result && typeof result === "object" && "file" in result ? result.file : null;
    if (stored) {
      const file = libraryFileSchema.parse(stored);
      if (file.scanStatus === "infected" && !file.references.length) {
        const objects = getDefaultObjectStore();
        if (!objects?.available()) throw new Error("Storage is unavailable");
        if (file.objectKey) {
          if (file.objectKey !== `sharemeatsack/library/${file.id}/sealed/${file.scanAttemptId}`)
            throw new Error("Invalid stored key");
          await objects.delete(file.objectKey);
          if (await objects.head(file.objectKey)) throw new Error("Storage cleanup failed");
        }
        if (file.uploadKey !== `sharemeatsack/library/${file.id}/upload`)
          throw new Error("Invalid upload key");
        await objects.delete(file.uploadKey);
      }
    }
    return Response.json({ ok: true }, { headers });
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503, headers });
  }
}
