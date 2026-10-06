export type UploadPhase = "uploading" | "retrying";

export function putBrowserFile(
  url: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.setRequestHeader("content-type", file.type || "application/octet-stream");
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) {
        resolve();
      } else {
        reject(new Error(`Storage refused the upload (${request.status}).`));
      }
    });
    request.addEventListener("error", () =>
      reject(new Error("Couldn't reach file storage. Please retry.")),
    );
    request.addEventListener("abort", () =>
      reject(new Error("Upload was interrupted. Please retry.")),
    );
    request.send(file);
  });
}

export async function uploadWithRetry(input: {
  uploadUrl: string;
  put: (url: string) => Promise<void>;
  refresh: () => Promise<string>;
  onPhase: (phase: UploadPhase) => void;
}): Promise<void> {
  let url = input.uploadUrl;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    input.onPhase(attempt === 0 ? "uploading" : "retrying");
    try {
      await input.put(url);
      return;
    } catch (error) {
      if (attempt === 2) {
        throw error;
      }
      url = await input.refresh();
    }
  }
}
