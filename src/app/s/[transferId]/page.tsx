import type { Metadata } from "next";
import { FileBrowser } from "@/components/file-browser";
import { FileAccessProvider } from "@/components/file-access";
import { FileSize } from "@/components/file-size";
import { PlainTransfer, TransferShell } from "@/components/transfer-chrome";
import {
  PublicTransferSharing,
  PublicTransferSave,
  TransferProductEntry,
} from "@/components/public-transfer-sharing";
import { incomingSaveUrl, publicTransferShareUrl } from "@/lib/public-sharing";
import { publicOrigin } from "@/lib/public-origin";
import { getDefaultTransferService } from "@/lib/app-transfers";
import { humanScreenFor, isTransferServiceError, uploadPageCopy } from "@/lib/transfers";
import { UploadDropzone } from "./upload-dropzone";
import { TransferRefresh } from "./transfer-refresh";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ transferId: string }>;
  searchParams: Promise<{ t?: string; token?: string }>;
};

export async function generateMetadata(): Promise<Metadata> {
  return { robots: { index: false, follow: false } };
}

export default async function UploadPage({ params, searchParams }: PageProps) {
  const { transferId } = await params;
  const query = await searchParams;
  const publicToken = query.t ?? query.token;
  const view = await getDefaultTransferService().getForPublic({
    transferId,
    publicToken,
  });
  const screen = humanScreenFor(view);
  const copy = uploadPageCopy(screen);
  const title = isTransferServiceError(view) ? undefined : view.title;
  const message = isTransferServiceError(view) ? undefined : view.message;
  const publicUrl =
    screen === "ready" && !isTransferServiceError(view) && publicToken
      ? publicTransferShareUrl(publicOrigin(), view.transferId, publicToken)
      : null;
  const savePublicUrl =
    !isTransferServiceError(view) &&
    ((view.kind === "send" && view.status === "ready") ||
      (view.kind === "request" && view.status === "open")) &&
    publicToken
      ? publicTransferShareUrl(publicOrigin(), view.transferId, publicToken)
      : null;
  const saveUrl = savePublicUrl
    ? incomingSaveUrl(process.env.LANYARD_URL ?? "https://meatsack.puregaz.com", savePublicUrl)
    : null;
  const saveEntry =
    saveUrl && savePublicUrl && !isTransferServiceError(view) ? (
      <PublicTransferSave
        href={saveUrl}
        link={{ url: savePublicUrl, title: view.title, expiresAt: view.expiresAt }}
      />
    ) : null;
  const sharingUnavailableReason =
    screen === "expired"
      ? "This link has expired."
      : screen === "cancelled"
        ? "This transfer was cancelled."
        : screen === "unknown"
          ? "The public link is invalid."
          : screen === "scanning"
            ? "The files are still being checked."
            : "The sender is still preparing these files.";
  const Frame =
    screen === "unknown" || screen === "expired" || screen === "cancelled"
      ? PlainTransfer
      : TransferShell;

  return (
    <Frame wide={screen === "ready"}>
      {screen === "scanning" || screen === "not_ready" ? <TransferRefresh /> : null}
      {title ? <h1 className="text-2xl font-semibold tracking-tight">{title}</h1> : null}
      {message ? <p className="mt-2 text-muted-foreground">{message}</p> : null}
      <section className={title ? "mt-8" : ""}>
        <h2 className="text-xl font-medium tracking-tight">{copy.heading}</h2>
        <p className="mt-2 text-muted-foreground">{copy.body}</p>
        {screen === "open" && !isTransferServiceError(view) && publicToken ? (
          <UploadDropzone
            transferId={view.transferId}
            publicToken={publicToken}
            files={view.files}
          />
        ) : null}
        {screen === "scanning" && !isTransferServiceError(view) ? (
          <ul className="mt-6 space-y-2 text-sm text-foreground">
            {view.files.map((file) => (
              <li key={file.id}>
                {file.name} · <FileSize bytes={file.size} />
              </li>
            ))}
          </ul>
        ) : null}
        {screen === "complete" && !isTransferServiceError(view) ? (
          <ul className="mt-6 space-y-2 text-sm text-foreground">
            {view.files.map((file) => (
              <li key={file.id}>
                {file.name} · <FileSize bytes={file.size} />
              </li>
            ))}
          </ul>
        ) : null}
        {screen === "ready" && !isTransferServiceError(view) ? (
          <FileAccessProvider access={publicToken ? { transferId, token: publicToken } : undefined}>
            <FileBrowser
              files={view.files}
              title={view.title}
              message={view.message}
              shareControls={
                <PublicTransferSharing
                  link={
                    publicUrl
                      ? { url: publicUrl, title: view.title, expiresAt: view.expiresAt }
                      : undefined
                  }
                  saveEntry={saveEntry}
                />
              }
            />
          </FileAccessProvider>
        ) : null}
      </section>
      {screen === "open" && saveEntry ? <div className="mt-6">{saveEntry}</div> : null}
      {screen !== "ready" ? (
        screen === "open" ||
        screen === "complete" ||
        (screen === "scanning" && !isTransferServiceError(view) && view.kind === "request") ? (
          <div className="mt-8">
            <TransferProductEntry />
          </div>
        ) : (
          <PublicTransferSharing unavailableReason={sharingUnavailableReason} />
        )
      ) : null}
    </Frame>
  );
}
