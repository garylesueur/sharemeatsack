import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SHAREMEATSACK_SKILL_MARKDOWN } from "./sharemeatsack-skill";
import { PRODUCT_NAME, PRODUCT_ORIGIN } from "./product";

const root = process.cwd();

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(join(root, name), "utf8"));
}

describe("Agent Plugin package", () => {
  it("declares the portable manifest", () => {
    const manifest = readJson("plugin.json") as {
      $schema: string;
      name: string;
      homepage: string;
      author: { name: string; url: string };
    };
    expect(manifest.$schema).toBe("https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
    expect(manifest.name).toBe(PRODUCT_NAME);
    expect(manifest.homepage).toBe(PRODUCT_ORIGIN);
    expect(manifest.author).toEqual({
      name: "Gary Le Sueur",
      url: "https://gaz.dev",
    });
  });

  it("declares a Cursor plugin so the clone can be added from a local folder", () => {
    const cursor = readJson(".cursor-plugin/plugin.json") as {
      name: string;
      skills: string;
      mcpServers: string;
    };
    const portable = readJson("plugin.json") as { name: string };
    expect(cursor.name).toBe(portable.name);
    expect(cursor.skills).toBe("./skills/");
    expect(cursor.mcpServers).toBe("./mcp.json");
  });

  it("keeps cursor.directory .mcp.json on the same URL", () => {
    const directory = readJson(".mcp.json") as {
      mcpServers: Record<string, { url: string }>;
    };
    const mcp = readJson("mcp.json") as {
      mcpServers: Record<string, { url: string }>;
    };
    expect(directory.mcpServers[PRODUCT_NAME]?.url).toBe(mcp.mcpServers[PRODUCT_NAME]?.url);
  });

  it("points the hosted MCP server at the product origin", () => {
    const mcp = readJson("mcp.json") as {
      mcpServers: Record<string, { type: string; url: string }>;
    };
    expect(mcp.mcpServers[PRODUCT_NAME]).toEqual({
      type: "streamable-http",
      url: `${PRODUCT_ORIGIN}/mcp`,
    });
  });

  it("ships the plugin skill with the same instructions as /skill.md", () => {
    const onDisk = readFileSync(join(root, "skills/sharemeatsack/SKILL.md"), "utf8");
    expect(onDisk.startsWith("---\n")).toBe(true);
    expect(onDisk).toContain("name: sharemeatsack\n");
    const body = onDisk.replace(/^---\n[\s\S]*?\n---\n\n/, "");
    expect(body).toBe(SHAREMEATSACK_SKILL_MARKDOWN);
  });

  it("has no stale generated copies of the skill", () => {
    const result = spawnSync("node", ["scripts/sync-skill.mjs", "--check"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("has no stale generated copies of the brand", () => {
    const result = spawnSync("node", ["brand/scripts/sync-brand.mjs", "--check"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});
