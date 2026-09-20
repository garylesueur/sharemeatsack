"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PublicFileView } from "@/lib/transfers";

type Row = {
  id: string;
  name: string;
  size: number;
  status: "pending" | "uploading" | "done" | "error";
  detail?: string;
};

function tokenQuery(publicToken: string): string {
  return `t=${encodeURIComponent(publicToken)}`;
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? response.statusText;
  } catch {
    return response.statusText;
  }
}

export function UploadDropzone({
  transferId,
  publicToken,
  files,
}: {
  transferId: string;
  publicToken: string;
  files: PublicFileView[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() =>
    files.map((file) => ({
      id: file.id,
      name: file.name,
      size: file.size,
      status: file.state === "accepted" ? "done" : "pending",
    })),
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();

  function patch(id: string, next: Partial<Row>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...next } : row)));
  }

  async function registerAndPut(list: File[]) {
    setBusy(true);
    setNotice(undefined);
    try {
      const registered = await fetch(
        `/api/v1/transfers/${transferId}/files?${tokenQuery(publicToken)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            files: list.map((file) => ({
              name: file.name,
              type: file.type,
              size: file.size,
            })),
          }),
        },
      );
      if (!registered.ok) {
        setNotice(await readError(registered));
        return;
      }
      const body = (await registered.json()) as {
        files: { id: string; name: string; size: number; uploadUrl: string }[];
      };
      setRows((current) => [
        ...current,
        ...body.files.map((file) => ({
          id: file.id,
          name: file.name,
          size: file.size,
          status: "uploading" as const,
        })),
      ]);
      for (const [index, offered] of list.entries()) {
        const record = body.files[index];
        if (!record) {
          continue;
        }
        const put = await fetch(record.uploadUrl, {
          method: "PUT",
          headers: {
            "content-type": offered.type || "application/octet-stream",
          },
          body: offered,
        });
        if (put.ok) {
          patch(record.id, { status: "done" });
          continue;
        }
        const refresh = await fetch(
          `/api/v1/transfers/${transferId}/files/${record.id}/refresh-url?${tokenQuery(publicToken)}`,
          { method: "POST" },
        );
        if (!refresh.ok) {
          patch(record.id, { status: "error", detail: await readError(refresh) });
          continue;
        }
        const next = (await refresh.json()) as { uploadUrl: string };
        const again = await fetch(next.uploadUrl, {
          method: "PUT",
          headers: {
            "content-type": offered.type || "application/octet-stream",
          },
          body: offered,
        });
        patch(
          record.id,
          again.ok ? { status: "done" } : { status: "error", detail: "Upload failed. Try again." },
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setNotice(undefined);
    try {
      const response = await fetch(
        `/api/v1/transfers/${transferId}/files/${id}?${tokenQuery(publicToken)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        setNotice(await readError(response));
        return;
      }
      setRows((current) => current.filter((row) => row.id !== id));
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setBusy(true);
    setNotice(undefined);
    try {
      const response = await fetch(
        `/api/v1/transfers/${transferId}/complete?${tokenQuery(publicToken)}`,
        {
          method: "POST",
        },
      );
      if (!response.ok) {
        setNotice(await readError(response));
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    setNotice(undefined);
    try {
      const response = await fetch(
        `/api/v1/transfers/${transferId}/cancel?${tokenQuery(publicToken)}`,
        {
          method: "POST",
        },
      );
      if (!response.ok) {
        setNotice(await readError(response));
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6">
      <div
        className="rounded-xl border border-dashed border-border bg-card"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const dropped = [...event.dataTransfer.files];
          if (dropped.length > 0) {
            void registerAndPut(dropped);
          }
        }}
      >
        <label className="block cursor-pointer px-4 py-10 text-center text-muted-foreground">
          <input
            type="file"
            multiple
            className="sr-only"
            disabled={busy}
            onChange={(event) => {
              const chosen = [...(event.target.files ?? [])];
              event.target.value = "";
              if (chosen.length > 0) {
                void registerAndPut(chosen);
              }
            }}
          />
          Drop files here, or choose them
        </label>
      </div>
      {rows.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-sm"
            >
              <span>
                {row.name} · {row.status}
                {row.detail ? ` — ${row.detail}` : ""}
              </span>
              <button
                type="button"
                className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
                disabled={busy}
                onClick={() => void remove(row.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {notice ? <p className="mt-3 text-sm text-red-700">{notice}</p> : null}
      <div className="mt-6 flex gap-3">
        <button
          type="button"
          className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
          disabled={busy || rows.length === 0}
          onClick={() => void finish()}
        >
          Finish
        </button>
        <button
          type="button"
          className="rounded-md px-3 py-2 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
          disabled={busy}
          onClick={() => void cancel()}
        >
          Cancel request
        </button>
      </div>
    </div>
  );
}
