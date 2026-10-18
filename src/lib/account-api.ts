import { createAccountAuthority } from "./account-authority";
import { jsonError } from "./app-transfers";

export async function verifyAccountRequest(request: Request) {
  return createAccountAuthority({
    lanyardUrl: process.env.LANYARD_URL ?? "https://meatsack.puregaz.com",
    product: "sharemeatsack",
  })(request.headers.get("authorization"));
}

export function accountUnauthorized(): Response {
  return privateAccountResponse(
    jsonError(401, "unauthorized", "A valid account credential is required"),
  );
}

export function privateAccountResponse(response: Response): Response {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Vary", "Authorization");
  return response;
}
