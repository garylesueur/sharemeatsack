"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { putBrowserFile, uploadWithRetry } from "@/lib/browser-upload";
import type { PublicFileView } from "@/lib/transfers";

type Row = {
  id: string;
  name: string;
  size: number;
  status: "pending" | "uploading" | "retrying" | "done" | "error";
  progress?: number;
  file?: File;
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

  async function freshUploadUrl(id: string): Promise<string> {
    const response = await fetch(
      `/api/v1/transfers/${transferId}/files/${id}/refresh-url?${tokenQuery(publicToken)}`,
      { method: "POST" },
    );
    if (!response.ok) {
      throw new Error(await readError(response));
    }
    return ((await response.json()) as { uploadUrl: string }).uploadUrl;
  }

  async function upload(id: string, file: File, uploadUrl: string) {
    patch(id, { detail: undefined, progress: 0 });
    try {
      await uploadWithRetry({
        uploadUrl,
        put: (url) => putBrowserFile(url, file, (progress) => patch(id, { progress })),
        refresh: () => freshUploadUrl(id),
        onPhase: (status) => patch(id, { status, progress: 0 }),
      });
      patch(id, { status: "done", progress: 100 });
    } catch (error) {
      patch(id, {
        status: "error",
        detail: error instanceof Error ? error.message : "Upload failed. Please retry.",
      });
    }
  }

  async function retry(row: Row) {
    if (!row.file) return;
    setBusy(true);
    setNotice(undefined);
    try {
      await upload(row.id, row.file, await freshUploadUrl(row.id));
    } catch (error) {
      patch(row.id, {
        status: "error",
        detail: error instanceof Error ? error.message : "Couldn't retry the upload.",
      });
    } finally {
      setBusy(false);
    }
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
        ...body.files.map((file, index) => ({
          id: file.id,
          name: file.name,
          size: file.size,
          status: "pending" as const,
          file: list[index],
        })),
      ]);
      for (const [index, offered] of list.entries()) {
        const record = body.files[index];
        if (!record) {
          continue;
        }
        await upload(record.id, offered, record.uploadUrl);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Something went wrong. Please retry.");
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
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Something went wrong. Please retry.");
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
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Something went wrong. Please retry.");
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
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Something went wrong. Please retry.");
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
          if (busy) return;
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
                {row.name} · {(row.size / (1024 * 1024)).toFixed(1)} MiB · {row.status}
                {row.status === "uploading" || row.status === "retrying"
                  ? ` ${row.progress ?? 0}%`
                  : ""}
                {row.detail ? ` — ${row.detail}` : ""}
              </span>
              {row.status === "error" && row.file ? (
                <button
                  type="button"
                  disabled={busy}
                  className="underline underline-offset-4"
                  onClick={() => void retry(row)}
                >
                  Retry
                </button>
              ) : null}
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
          disabled={
            busy ||
            rows.length === 0 ||
            rows.some(
              (row) =>
                row.status === "error" ||
                row.status === "uploading" ||
                row.status === "retrying" ||
                (row.status === "pending" && Boolean(row.file)),
            )
          }
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
