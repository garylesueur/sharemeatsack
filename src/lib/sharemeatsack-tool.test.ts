import { describe, expect, it } from "vitest";
import { createSharemeatsackTool, SHAREMEATSACK_TOOL_NAME } from "./sharemeatsack-tool";
import { createMemoryTransferStore } from "./transfer-store";
import { createTransferService, isTransferServiceError } from "./transfers";

function isolated() {
  const store = createMemoryTransferStore();
  const created = new Date("2026-09-19T12:00:00.000Z");
  const transfers = createTransferService({
    store,
    now: () => created,
    createId: () => "transfer-1",
    createToken: (() => {
      let n = 0;
      return () => `token-${++n}`;
    })(),
  });
  return {
    transfers,
    tool: createSharemeatsackTool(transfers),
  };
}

describe("B1 — one tool named sharemeatsack.com", () => {
  it("uses the product name as the only tool name", () => {
    const { tool } = isolated();
    expect(tool.name).toBe(SHAREMEATSACK_TOOL_NAME);
    expect(tool.name).toBe("sharemeatsack.com");
  });
});

describe("B1 — tool create matches HTTP create", () => {
  it("returns the same request links as the HTTP service", async () => {
    const viaTool = isolated();
    const viaHttp = isolated();
    const toolResult = await viaTool.tool.invoke({
      action: "request",
      title: "Invoices",
    });
    const httpResult = await viaHttp.transfers.createRequest({
      action: "request",
      title: "Invoices",
    });
    expect(isTransferServiceError(toolResult)).toBe(false);
    expect(toolResult).toEqual(httpResult);
  });

  it("refuses a missing title the same way HTTP does", async () => {
    const { tool, transfers } = isolated();
    const viaTool = await tool.invoke({ action: "request" });
    const viaHttp = await transfers.createRequest({ action: "request" });
    expect(viaTool).toEqual(viaHttp);
    expect(viaTool).toMatchObject({ code: "invalid_request", status: 400 });
  });
});

describe("B5 — tool status and cancel match HTTP", () => {
  it("status after create matches getForAgent", async () => {
    const { tool, transfers } = isolated();
    await tool.invoke({ action: "request", title: "Invoices" });
    const viaTool = await tool.invoke({
      action: "status",
      transferId: "transfer-1",
      agentToken: "token-2",
    });
    const viaHttp = await transfers.getForAgent({
      transferId: "transfer-1",
      agentToken: "token-2",
    });
    expect(viaTool).toEqual(viaHttp);
    expect(viaTool).toMatchObject({ status: "open", title: "Invoices" });
  });

  it("cancel while open becomes cancelled", async () => {
    const { tool } = isolated();
    await tool.invoke({ action: "request", title: "Invoices" });
    const result = await tool.invoke({
      action: "cancel",
      transferId: "transfer-1",
      agentToken: "token-2",
    });
    expect(result).toMatchObject({ status: "cancelled" });
  });

  it("status without the agent token does not leak the request", async () => {
    const { tool } = isolated();
    await tool.invoke({ action: "request", title: "Invoices" });
    const result = await tool.invoke({
      action: "status",
      transferId: "transfer-1",
    });
    expect(result).toMatchObject({ code: "not_found", status: 404 });
  });
});
