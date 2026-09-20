import type { Metadata } from "next";
import { PlainTransfer, TransferShell } from "@/components/transfer-chrome";
import { getDefaultTransferService } from "@/lib/app-transfers";
import { isTransferServiceError, uploadPageCopy } from "@/lib/transfers";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ transferId: string }>;
  searchParams: Promise<{ token?: string }>;
};

export async function generateMetadata(): Promise<Metadata> {
  return { robots: { index: false, follow: false } };
}

export default async function ManagePage({ params, searchParams }: PageProps) {
  const { transferId } = await params;
  const { token } = await searchParams;
  const view = await getDefaultTransferService().getForAgent({
    transferId,
    agentToken: token,
  });
  if (isTransferServiceError(view)) {
    const copy = uploadPageCopy("unknown");
    return (
      <PlainTransfer>
        <h1 className="text-2xl font-semibold tracking-tight">{copy.heading}</h1>
        <p className="mt-2 text-muted-foreground">{copy.body}</p>
      </PlainTransfer>
    );
  }

  return (
    <TransferShell>
      <p className="text-sm text-muted-foreground">
        Private manage link — not for the person uploading.
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{view.title}</h1>
      {view.message ? <p className="mt-2 text-foreground">{view.message}</p> : null}
      <dl className="mt-6 space-y-2 text-sm text-foreground">
        <div>
          <dt className="font-medium">Status</dt>
          <dd>{view.status}</dd>
        </div>
        <div>
          <dt className="font-medium">Expires</dt>
          <dd>{view.expiresAt}</dd>
        </div>
        <div>
          <dt className="font-medium">{view.kind === "send" ? "Download link" : "Upload link"}</dt>
          <dd className="break-all">{view.kind === "send" ? view.downloadUrl : view.uploadUrl}</dd>
        </div>
      </dl>
      <h2 className="mt-8 text-lg font-medium">Files</h2>
      {view.files.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No files yet.</p>
      ) : (
        <ul className="mt-3 space-y-2 text-sm text-foreground">
          {view.files.map((file) => (
            <li key={file.id}>
              {file.name} · {file.size} bytes · {file.scanStatus}
              {file.downloadUrl ? (
                <>
                  {" "}
                  ·{" "}
                  <a
                    className="underline underline-offset-4 hover:text-primary"
                    href={file.downloadUrl}
                  >
                    Download
                  </a>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </TransferShell>
  );
}
