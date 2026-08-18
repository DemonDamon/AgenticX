import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONTEXT_WINDOW,
  MODEL_CONTEXT_WINDOWS,
  formatContextWindowShort,
  resolveHeuristicContextWindow,
} from "../src/utils/model-context-window-heuristic";

/**
 * 这份 TS 表只是给填写界面显示「自动会解析成多少」用的，权威在 Python。
 * 两边一旦走偏，界面就会显示一个后端根本不会用的数字 —— 这个测试就是防这个。
 */
const PY_SOURCE = resolve(__dirname, "../../agenticx/runtime/model_context_window.py");

function parsePythonTable(): { table: Array<[string, number]>; fallback: number } {
  const text = readFileSync(PY_SOURCE, "utf-8");
  const listBody = /MODEL_CONTEXT_WINDOWS: list\[tuple\[str, int\]\] = \[([\s\S]*?)\]/.exec(text);
  if (!listBody) throw new Error("未能在 Python 源码中定位 MODEL_CONTEXT_WINDOWS");
  const table: Array<[string, number]> = [];
  for (const row of (listBody[1] ?? "").matchAll(/\(\s*"([^"]+)"\s*,\s*([0-9_]+)\s*\)/g)) {
    const key = row[1];
    const window = row[2];
    if (key === undefined || window === undefined) continue;
    table.push([key, Number(window.replace(/_/g, ""))]);
  }
  const fallback = /DEFAULT_CONTEXT_WINDOW = ([0-9_]+)/.exec(text);
  if (!fallback?.[1]) throw new Error("未能在 Python 源码中定位 DEFAULT_CONTEXT_WINDOW");
  return { table, fallback: Number(fallback[1].replace(/_/g, "")) };
}

describe("model context window parity with the Python resolver", () => {
  it("mirrors the table verbatim, order included", () => {
    const { table } = parsePythonTable();
    expect(table.length).toBeGreaterThan(0);
    // 顺序有意义：按子串匹配先命中者胜，glm-5.2 必须排在 glm 前面。
    expect(MODEL_CONTEXT_WINDOWS.map(([k, v]) => [k, v])).toEqual(table);
  });

  it("mirrors the fallback window", () => {
    expect(DEFAULT_CONTEXT_WINDOW).toBe(parsePythonTable().fallback);
  });

  it("resolves the same values the backend would", () => {
    expect(resolveHeuristicContextWindow("glm-5.2")).toBe(1_000_000);
    expect(resolveHeuristicContextWindow("glm-4.7")).toBe(128_000);
    expect(resolveHeuristicContextWindow("moonshot-v1-8k")).toBe(8_000);
    expect(resolveHeuristicContextWindow("gpt-4-32k")).toBe(32_000);
    // 参数量不是窗口
    expect(resolveHeuristicContextWindow("qwen3-32b")).toBe(128_000);
    expect(resolveHeuristicContextWindow("llama3.1:8b")).toBe(128_000);
    expect(resolveHeuristicContextWindow("unknown-model")).toBe(128_000);
  });
});

describe("formatContextWindowShort", () => {
  it("renders the placeholder numbers a user can compare against", () => {
    expect(formatContextWindowShort(128_000)).toBe("128K");
    expect(formatContextWindowShort(1_000_000)).toBe("1M");
    expect(formatContextWindowShort(1_048_576)).toBe("1.0M");
    expect(formatContextWindowShort(32_768)).toBe("32.8K");
  });
});
