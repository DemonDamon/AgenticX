import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  INTERRUPTED_TEXT,
  NEEDS_USER_ACTION_MARKERS,
  applyRunOutcome,
  applyUserEnableToggle,
  markInterruptedOnStartup,
  markRunStarted,
  type RunHealthFields,
} from "../electron/automation-run-health";

const fixturePath = path.join(__dirname, "../../tests/fixtures/automation_run_health_cases.json");

type HealthCase = {
  name: string;
  before: RunHealthFields & Record<string, unknown>;
  action: "start" | "outcome" | "startup" | "toggle";
  args: Record<string, unknown>;
  expect: Record<string, unknown>;
};

const cases = JSON.parse(readFileSync(fixturePath, "utf-8")) as HealthCase[];

function step(
  task: RunHealthFields & Record<string, unknown>,
  action: HealthCase["action"],
  args: Record<string, unknown>,
): RunHealthFields & Record<string, unknown> {
  if (action === "start") {
    return markRunStarted(task, String(args.nowIso));
  }
  if (action === "outcome") {
    return applyRunOutcome(
      task,
      {
        ok: Boolean(args.ok),
        error: typeof args.error === "string" ? args.error : undefined,
      },
      {
        trigger: args.trigger === "manual" ? "manual" : "schedule",
        nowIso: String(args.nowIso),
      },
    );
  }
  if (action === "startup") {
    const runningIds = new Set(Array.isArray(args.runningIds) ? args.runningIds.map(String) : []);
    const id = String(args.id ?? task.id ?? "");
    return markInterruptedOnStartup(task, runningIds, id);
  }
  const next = structuredClone(args.next) as RunHealthFields & Record<string, unknown>;
  return applyUserEnableToggle(task, next);
}

function applyCase(healthCase: HealthCase): Record<string, unknown> {
  const repeat = typeof healthCase.args.repeat === "number" ? healthCase.args.repeat : 1;
  let current = structuredClone(healthCase.before);
  for (let i = 0; i < repeat; i += 1) {
    current = step(current, healthCase.action, healthCase.args);
  }
  return current;
}

describe("automation run health", () => {
  it("matches the needs-user-action table and omits approval timeout", () => {
    expect(NEEDS_USER_ACTION_MARKERS).toEqual([
      { needle: "无人值守运行不批准受保护操作", label: "任务里有需要批准的操作" },
      { needle: "企业登录已失效", label: "企业账号登录已失效" },
      { needle: "invalid_api_key", label: "模型 API Key 无效" },
      { needle: "incorrect api key", label: "模型 API Key 无效" },
      { needle: "http 401", label: "鉴权失败" },
      { needle: "http 403", label: "没有权限" },
    ]);
    expect(NEEDS_USER_ACTION_MARKERS.map((marker) => marker.needle)).not.toContain("无人值守等待审批超时");
  });

  it("does not mutate its input", () => {
    const task = { id: "x", enabled: true, lastRunError: "x" };
    const snapshot = structuredClone(task);
    markRunStarted(task, "2026-10-12T00:00:00.000Z");
    applyRunOutcome(task, { ok: false, error: "e" }, { trigger: "schedule", nowIso: "2026-10-12T00:00:00.000Z" });
    markInterruptedOnStartup({ ...task, runningSince: "t" }, new Set(), "x");
    applyUserEnableToggle(task, { enabled: true });
    expect(task).toEqual(snapshot);
  });

  it.each(cases)("$name", (healthCase) => {
    expect(applyCase(healthCase)).toEqual(healthCase.expect);
  });

  it("interrupted copy matches INTERRUPTED_TEXT", () => {
    const interrupted = cases.find((healthCase) => healthCase.name.startsWith("AC-7"));
    expect(interrupted?.expect.lastRunError).toBe(INTERRUPTED_TEXT);
  });
});
