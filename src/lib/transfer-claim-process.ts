import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { boundedClaimBytes } from "./claim-body";

const binding = z.object({ intentId: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/) }).strict();
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });

export function verifyTransferClaimProcess(
  payload: string,
  header: string | null,
  secret: string,
  now = Date.now(),
) {
  if (!secret || !header) return false;
  const match = /^t=(\d{1,12}),v1=([a-f0-9]{64})$/.exec(header);
  if (!match || Math.abs(now - Number(match[1]) * 1000) > 300_000) return false;
  const expected = createHmac("sha256", secret)
    .update(`${Number(match[1])}.sharemeatsack-claim-process.${payload}`)
    .digest();
  return timingSafeEqual(Buffer.from(match[2], "hex"), expected);
}

/** Scheduled work carries only an opaque selector. The worker re-reads native claim authority. */
export async function transferClaimProcessRequest(
  request: Request,
  ports: {
    secret: string;
    process(intentId: string): Promise<boolean>;
    now?: () => number;
  },
) {
  try {
    if (request.method !== "POST" || new URL(request.url).search || !request.body)
      return json({ error: "invalid_request" }, 400);
    const payload = new TextDecoder("utf-8", { fatal: true }).decode(
      await boundedClaimBytes(request.body, 512),
    );
    if (
      !verifyTransferClaimProcess(
        payload,
        request.headers.get("transfer-claim-process-signature"),
        ports.secret,
        ports.now?.(),
      )
    )
      return json({ error: "unauthorized" }, 401);
    const input = binding.safeParse(JSON.parse(payload));
    if (!input.success) return json({ error: "invalid_request" }, 400);
    return (await ports.process(input.data.intentId))
      ? json({ ok: true })
      : json({ ok: false }, 409);
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}
