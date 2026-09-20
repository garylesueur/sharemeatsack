import type { AgentFile, AgentTransferView } from "./transfers";

export function manageMarkdown(view: AgentTransferView): string {
  const lines = [
    `# ${view.title}`,
    "",
    "Private owner summary for sharemeatsack.com. Do not give this link to the person uploading.",
    "",
    `- Status: \`${view.status}\``,
    `- Expires: ${view.expiresAt}`,
    `- Share with the person: ${view.kind === "send" ? view.downloadUrl : view.uploadUrl}`,
    `- This summary: ${view.manageUrl}`,
  ];
  if (view.message) {
    lines.push("", "## Message", "", view.message);
  }
  lines.push("", "## Files");
  if (view.files.length === 0) {
    lines.push("", view.status === "complete" ? "No files were accepted." : "No files yet.");
  } else {
    lines.push("");
    for (const file of view.files) {
      lines.push(`- ${fileLine(file)}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function fileLine(file: AgentFile): string {
  const url = file.downloadUrl ? ` — ${file.downloadUrl}` : "";
  return `${file.name} (${file.size} bytes, ${file.scanStatus})${url}`;
}
