const TRUSTED_HEADER = "x-vercel-forwarded-for";

export const SHARED_BUCKET = "shared";

export function clientIpFromRequest(request: Request): string {
  const forwarded = request.headers.get(TRUSTED_HEADER);
  if (!forwarded) {
    return SHARED_BUCKET;
  }
  const first = forwarded.split(",")[0]?.trim();
  return first || SHARED_BUCKET;
}
