import type { Step, UseCase } from "@/components/home-sections";

/** The words. Everything structural lives in the shared components. */

export const HERO = {
  eyebrow: "MCP · Skill · HTTP",
  steps: [
    {
      n: "Step 1",
      heading: "The agent creates",
      body: "One call builds a request or a send and returns a page link. No project to set up, no dashboard to learn.",
    },
    {
      n: "Step 2",
      heading: "Files land on the page",
      body: "Simon drops them, or the agent puts them. Either way the bytes sit on that page, not in chat.",
    },
    {
      n: "Step 3",
      heading: "Share the link",
      body: "Paste the page. Confirm him only if a person will open it. Put files on meatsack and send them to Simon are the same send.",
    },
  ] satisfies Step[],
};

export const USE_CASES: UseCase[] = [
  {
    tag: "Invoices",
    heading: "Get the files from Simon",
    body: "The agent needs the pack and will not guess a path. It creates a request and waits.",
    quote: "“Drop the September invoices here.”",
  },
  {
    tag: "A pack",
    heading: "Send them to Simon",
    body: "The files are ready. The agent puts them on the page and pastes the link.",
    quote: "“These three are for you.”",
  },
  {
    tag: "Later",
    heading: "Put this on meatsack",
    body: "Same send. Nobody has to open it now. The page holds the files until they expire.",
    quote: "“Leave them here for later.”",
  },
  {
    tag: "Unattended",
    heading: "One request per person",
    body: "A job creates a separate upload page for every name on a list and collects them as they land.",
  },
];

export const SEAM_SEND = {
  title: "September invoices",
  files: [
    { name: "invoice-q3.pdf", type: "application/pdf", size: 184320 },
    { name: "notes.txt", type: "text/plain", size: 412 },
  ],
} as const;

const PUNCT = "text-machine-muted";
const KEY = "text-sky-300";
const VALUE = "text-emerald-300";

/**
 * A send as a tool call. Tagged rather than interpolated, so the sample can
 * never be parsed as markup.
 */
export const AGENT_SAMPLE: [string, string][] = [
  [PUNCT, "// the agent puts files on the page\n"],
  [PUNCT, "{\n  "],
  [KEY, '"action"'],
  [PUNCT, ": "],
  [VALUE, '"send"'],
  [PUNCT, ",\n  "],
  [KEY, '"title"'],
  [PUNCT, ": "],
  [VALUE, `"${SEAM_SEND.title}"`],
  [PUNCT, ",\n  "],
  [KEY, '"files"'],
  [PUNCT, ": ["],
  ...SEAM_SEND.files.flatMap((file, index): [string, string][] => [
    [PUNCT, `\n    { "name": `],
    [VALUE, `"${file.name}"`],
    [PUNCT, ', "type": '],
    [VALUE, `"${file.type}"`],
    [PUNCT, ', "size": '],
    [VALUE, String(file.size)],
    [PUNCT, index === SEAM_SEND.files.length - 1 ? " }" : " },"],
  ]),
  [PUNCT, "\n  ]\n}"],
];
