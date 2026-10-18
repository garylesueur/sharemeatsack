import { ZodError } from "zod";
import { verifyAccountRequest, accountUnauthorized, privateAccountResponse } from "./account-api";
import {
  getDefaultObjectStore,
  getDefaultTransferService,
  jsonServiceError,
} from "./app-transfers";
import { createOwnedWorkspaceService } from "./owned-workspace";
import { createOwnedTransferMetadata, OwnedTransferError } from "./owned-transfer-metadata";
import { publicOrigin } from "./public-origin";
import { isTransferServiceError } from "./transfers";
const json = (body: unknown, status = 200) =>
  privateAccountResponse(Response.json(body, { status }));
export async function ownedWorkspaceRequest(
  request: Request,
  operation: "send" | "keep" | "abortKeep" | "preview" | "download",
  transferId?: string,
  fileId?: string,
) {
  const authority = await verifyAccountRequest(request);
  if (authority.outcome !== "accepted") return accountUnauthorized();
  if (
    operation !== "send" &&
    (!transferId ||
      !fileId ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(transferId) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(fileId))
  )
    return json({ error: "not_found" }, 404);
  const service = createOwnedWorkspaceService({
    accountId: authority.account,
    metadata: createOwnedTransferMetadata(),
    objects: getDefaultObjectStore(),
    baseUrl: publicOrigin(),
  });
  try {
    if (operation === "send") return json(await service.createSend(await request.json()), 201);
    if (operation === "keep")
      return json(await service.keep(transferId!, fileId!, await request.json()));
    if (operation === "abortKeep")
      return json(await service.abortKeep(transferId!, fileId!, await request.json()));
    const result = await getDefaultTransferService().readFileForAccount({
      account: authority.account,
      transferId: transferId!,
      fileId: fileId!,
      purpose: operation,
    });
    return privateAccountResponse(
      isTransferServiceError(result) ? jsonServiceError(result) : Response.json(result),
    );
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof ZodError)
      return json({ error: "invalid_request" }, 400);
    if (error instanceof OwnedTransferError) return json({ error: error.code }, error.status);
    return json({ error: "unavailable" }, 503);
  }
}
