import { describe, expect, it } from "vitest";
import { splitAutomationExecutionContract } from "./automation-contract-display";

const contract = [
  "## Execution Contract (Auto Injected)",
  "- 这是执行任务，不是方案讨论。禁止输出“是否按此方案执行”。",
  "- 禁止把 MCP 工具名当作 bash 命令执行（例如 firecrawl_scrape）。",
  "- 时间窗口必须严格限定在最近 7 天，无法解析日期的条目直接丢弃。",
].join("\n");

describe("splitAutomationExecutionContract", () => {
  it("leaves a normal user query untouched", () => {
    expect(splitAutomationExecutionContract("汇总今日收盘价量")).toEqual({
      instruction: "汇总今日收盘价量",
      contractLines: [],
    });
  });

  it("separates the injected contract from the task instruction", () => {
    const split = splitAutomationExecutionContract(`${contract}\n\n抓取最近 7 天的公告并汇总。`);
    expect(split.instruction).toBe("抓取最近 7 天的公告并汇总。");
    expect(split.contractLines).toEqual([
      "这是执行任务，不是方案讨论。禁止输出“是否按此方案执行”。",
      "禁止把 MCP 工具名当作 bash 命令执行（例如 firecrawl_scrape）。",
      "时间窗口必须严格限定在最近 7 天，无法解析日期的条目直接丢弃。",
    ]);
    expect(split.instruction).not.toContain("Execution Contract");
  });

  it("keeps a contract-only message as rules with no leftover heading", () => {
    const split = splitAutomationExecutionContract(contract);
    expect(split.instruction).toBe("");
    expect(split.contractLines[0]).toContain("这是执行任务");
    expect(split.contractLines.join("\n")).not.toContain("##");
  });
});
