export type ViewFile = {
  id: string;
  name: string;
  size: number;
  type: string;
  scanStatus?: string;
  downloadUrl?: string;
  downloadUrlExpiresAt?: string;
};

export { formatFileSize as fileSize } from "./format-file-size";

export function scanLabel(file: ViewFile): string {
  switch (file.scanStatus) {
    case "skipped-too-large":
      return "Not scanned — too large";
    case "infected":
      return "Blocked — malware detected";
    case "failed":
      return "Blocked — scan failed";
    case "scanning":
      return "Scanning — not available yet";
    case "clean":
      return "Scanned";
    default:
      return file.downloadUrl ? "Available" : "Not available yet";
  }
}

export type FileFamily =
  | "image"
  | "video"
  | "audio"
  | "markdown"
  | "text"
  | "pdf"
  | "table"
  | "archive"
  | "office"
  | "other";

const extensionFamilies: Record<string, FileFamily> = {
  jpg: "image",
  jpeg: "image",
  png: "image",
  webp: "image",
  avif: "image",
  gif: "image",
  svg: "image",
  bmp: "image",
  ico: "image",
  mp4: "video",
  mov: "video",
  webm: "video",
  m4v: "video",
  ogv: "video",
  mkv: "video",
  mp3: "audio",
  wav: "audio",
  ogg: "audio",
  m4a: "audio",
  aac: "audio",
  flac: "audio",
  opus: "audio",
  md: "markdown",
  markdown: "markdown",
  pdf: "pdf",
  csv: "table",
  tsv: "table",
  txt: "text",
  log: "text",
  json: "text",
  yaml: "text",
  yml: "text",
  xml: "text",
  js: "text",
  jsx: "text",
  ts: "text",
  tsx: "text",
  css: "text",
  py: "text",
  rb: "text",
  sh: "text",
  sql: "text",
  toml: "text",
  ini: "text",
  conf: "text",
  env: "text",
  rs: "text",
  go: "text",
  java: "text",
  c: "text",
  h: "text",
  cpp: "text",
  html: "text",
  htm: "text",
  xhtml: "text",
  zip: "archive",
  tar: "archive",
  gz: "archive",
  tgz: "archive",
  rar: "archive",
  "7z": "archive",
  doc: "office",
  docx: "office",
  xls: "office",
  xlsx: "office",
  ppt: "office",
  pptx: "office",
  odt: "office",
  ods: "office",
  odp: "office",
  rtf: "office",
};

export function fileExtension(file: ViewFile): string {
  return file.name.toLowerCase().split(".").at(-1) ?? "";
}

export function classifyFile(file: ViewFile): { family: FileFamily; conflict: boolean } {
  const mime = file.type.toLowerCase().split(";")[0].trim();
  const ext = fileExtension(file);
  const hint = extensionFamilies[ext];
  if (
    ["html", "htm", "xhtml"].includes(ext) ||
    ["text/html", "application/xhtml+xml"].includes(mime)
  )
    return { family: "text", conflict: false };
  let family: FileFamily | undefined;
  if (mime.startsWith("image/")) family = "image";
  else if (mime.startsWith("video/")) family = "video";
  else if (mime.startsWith("audio/")) family = "audio";
  else if (["text/markdown", "text/x-markdown"].includes(mime)) family = "markdown";
  else if (mime === "application/pdf") family = "pdf";
  else if (["text/csv", "text/tab-separated-values", "application/csv"].includes(mime))
    family = "table";
  else if (
    ["application/json", "application/xml", "application/yaml", "application/javascript"].includes(
      mime,
    ) ||
    mime.startsWith("text/")
  )
    family = "text";
  else if (
    [
      "application/zip",
      "application/x-tar",
      "application/gzip",
      "application/x-7z-compressed",
      "application/vnd.rar",
    ].includes(mime)
  )
    family = "archive";
  else if (/officedocument|msword|ms-excel|ms-powerpoint|opendocument|application\/rtf/.test(mime))
    family = "office";
  const generic = !mime || mime === "application/octet-stream";
  if (!family && !generic) return { family: "other", conflict: false };
  if (family && hint && family !== hint) return { family: "other", conflict: true };
  return { family: family ?? hint ?? "other", conflict: false };
}

export function fileFamily(file: ViewFile): FileFamily {
  return classifyFile(file).family;
}

export const familyLabels: Record<FileFamily, string> = {
  image: "Images",
  video: "Videos",
  audio: "Audio",
  markdown: "Markdown",
  text: "Text & code",
  pdf: "PDFs",
  table: "Tables",
  archive: "Archives",
  office: "Office files",
  other: "Other files",
};

export type BrowserState = {
  selected: string | null;
  view: "list" | "grid";
  search: string;
  sort: "offered" | "name";
  filter: FileFamily | "all";
};

export function defaultBrowserState(files: ViewFile[]): BrowserState {
  return {
    selected: files.length === 1 ? files[0].id : null,
    view:
      files.length > 1 && files.every((f) => ["image", "video"].includes(fileFamily(f)))
        ? "grid"
        : "list",
    search: "",
    sort: "offered",
    filter: "all",
  };
}

export function visibleFiles(files: ViewFile[], state: BrowserState): ViewFile[] {
  const matching = files.filter(
    (f) =>
      (state.filter === "all" || fileFamily(f) === state.filter) &&
      f.name.toLowerCase().includes(state.search.toLowerCase()),
  );
  return state.sort === "name"
    ? matching.toSorted((a, b) => a.name.localeCompare(b.name, "en-GB", { numeric: true }))
    : matching;
}

export function stateFromUrl(url: URL, files: ViewFile[]): BrowserState {
  const state = defaultBrowserState(files);
  state.view =
    url.searchParams.get("view") === "grid"
      ? "grid"
      : url.searchParams.get("view") === "list"
        ? "list"
        : state.view;
  state.search = (url.searchParams.get("q") ?? "").slice(0, 256);
  state.sort = url.searchParams.get("sort") === "name" ? "name" : "offered";
  const filter = url.searchParams.get("type");
  if (filter && (filter === "all" || Object.hasOwn(familyLabels, filter)))
    state.filter = filter as BrowserState["filter"];
  const selected = url.searchParams.get("file");
  state.selected =
    files.length === 1
      ? files[0].id
      : visibleFiles(files, state).some((f) => f.id === selected)
        ? selected
        : null;
  return state;
}

export function stateUrl(url: URL, state: BrowserState): URL {
  const next = new URL(url);
  for (const [key, value] of Object.entries({
    file: state.selected,
    view: state.view,
    q: state.search || null,
    sort: state.sort === "name" ? "name" : null,
    type: state.filter === "all" ? null : state.filter,
  })) {
    if (value) next.searchParams.set(key, value);
    else next.searchParams.delete(key);
  }
  return next;
}
