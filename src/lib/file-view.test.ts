import { describe, expect, it } from "vitest";
import {
  classifyFile,
  defaultBrowserState,
  stateFromUrl,
  stateUrl,
  visibleFiles,
  type ViewFile,
} from "./file-view";
const files: ViewFile[] = [
  { id: "one", name: "Photo.png", type: "image/png", size: 10 },
  { id: "two", name: "Notes.md", type: "text/markdown", size: 20 },
  { id: "three", name: "Photo.png", type: "image/png", size: 30 },
];
describe("Viewing B3–B5/B7 — collection and safe type selection", () => {
  it("keeps mixed files discoverable and preserves offered order for equal names", () => {
    const state = defaultBrowserState(files);
    expect(state.view).toBe("list");
    expect(defaultBrowserState([files[0], files[2]]).view).toBe("grid");
    expect(visibleFiles(files, { ...state, sort: "name" }).map((f) => f.id)).toEqual([
      "two",
      "one",
      "three",
    ]);
    expect(
      visibleFiles(files, { ...state, search: "PHOTO", filter: "image" }).map((f) => f.id),
    ).toEqual(["one", "three"]);
  });
  it("refuses to restore foreign or filtered-out selections and ignores invalid view state", () => {
    const url = new URL("https://sharemeatsack.com/s/test?file=one&type=markdown&view=evil");
    expect(stateFromUrl(url, files)).toMatchObject({
      selected: null,
      view: "list",
      filter: "markdown",
    });
    url.search = "?file=foreign&type=unknown";
    expect(stateFromUrl(url, files)).toMatchObject({ selected: null, filter: "all" });
  });
  it("keeps existing capability context without adding credentials to new view fields", () => {
    const url = new URL("https://sharemeatsack.com/s/test/manage?token=private-fixture");
    const next = stateUrl(url, { ...defaultBrowserState(files), selected: "two", view: "grid" });
    expect(next.pathname).toBe(url.pathname);
    expect(next.searchParams.get("token")).toBe("private-fixture");
    expect(next.searchParams.get("file")).toBe("two");
    expect([...next.searchParams.values()].filter((v) => v === "private-fixture")).toHaveLength(1);
    expect(url.searchParams.has("file")).toBe(false);
  });
  it.each([
    ["photo.png", "application/octet-stream", "image", false],
    ["photo.png", "application/pdf", "other", true],
    ["page.html", "image/png", "text", false],
    ["notes.md", "text/markdown", "markdown", false],
    ["odd.binary", "application/x-unknown", "other", false],
  ])(
    "classifies %s with %s without treating metadata as executable content",
    (name, type, family, conflict) => {
      expect(classifyFile({ id: "fixture", name, type, size: 1 })).toEqual({ family, conflict });
    },
  );
});
