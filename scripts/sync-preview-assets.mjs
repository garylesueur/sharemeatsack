import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The installed package owns these assets. Never edit the generated public
// copies; regenerate them when the renderer dependency changes.
const require = createRequire(import.meta.url);
const source = dirname(require.resolve("pdfjs-dist/package.json"));
const { version } = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
const root = fileURLToPath(new URL("../public/_preview/pdfjs/", import.meta.url));
const target = join(root, version);
await rm(root, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(join(source, "LICENSE"), join(target, "LICENSE"));
await cp(join(source, "build/pdf.worker.min.mjs"), join(target, "pdf.worker.min.mjs"));
await Promise.all(
  ["cmaps", "standard_fonts", "wasm", "iccs"].map((directory) =>
    cp(join(source, directory), join(target, directory), { recursive: true }),
  ),
);
console.log(`PDF preview assets regenerated for ${version}.`);
