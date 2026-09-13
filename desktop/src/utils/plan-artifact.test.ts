import { describe, expect, it } from "vitest";
import {
  derivePlanProgress,
  findLatestPlanArtifact,
  isNaturalLanguagePlanBuildRequest,
  parsePlanArtifactToolResult,
  parsePlanMarkdown,
  type PlanArtifactPayload,
} from "./plan-artifact";

const payload = {
  type: "plan_artifact",
  action: "created",
  plan_id: "2026-09-09-demo-a1b2c3d4",
  path: "/repo/.agenticx/plans/2026-09-09-demo-a1b2c3d4.plan.md",
  name: "Demo Plan",
  overview: "Build the demo.",
  status: "ready",
  session_id: "session-1",
  todos: [
    { id: "one", content: "First task", status: "pending" },
    { id: "two", content: "Second task", status: "pending" },
  ],
} satisfies PlanArtifactPayload;

describe("plan-artifact", () => {
  it("parses a Plan tool result snapshot", () => {
    expect(parsePlanArtifactToolResult(JSON.stringify(payload))).toEqual(payload);
    expect(parsePlanArtifactToolResult("not json")).toBeNull();
    expect(parsePlanArtifactToolResult(JSON.stringify({ ...payload, type: "other" }))).toBeNull();
  });

  it("parses authoritative YAML frontmatter while preserving the path", () => {
    const markdown = `---
plan_id: 2026-09-09-demo-a1b2c3d4
name: Demo Plan
overview: Build the demo.
status: building
session_id: session-1
created_at: 2026-09-09T00:00:00+00:00
updated_at: 2026-09-09T00:01:00+00:00
planned_with: openai/gpt-test
todos:
  - id: one
    content: First task
    status: completed
  - id: two
    content: Second task
    status: in_progress
---

# Demo Plan
`;
    const parsed = parsePlanMarkdown(markdown, payload.path);
    expect(parsed?.path).toBe(payload.path);
    expect(parsed?.status).toBe("building");
    expect(parsed?.todos.map((todo) => todo.status)).toEqual(["completed", "in_progress"]);
  });

  it("derives completed and total progress without counting cancelled todos", () => {
    const progress = derivePlanProgress({
      ...payload,
      status: "building",
      todos: [
        { id: "one", content: "First", status: "completed" },
        { id: "two", content: "Second", status: "in_progress" },
        { id: "three", content: "Third", status: "cancelled" },
      ],
    });
    expect(progress).toEqual({ completed: 1, total: 2, percent: 50 });
  });

  it("recognizes concise natural-language Build confirmations", () => {
    expect(isNaturalLanguagePlanBuildRequest("好的，开始build吧")).toBe(true);
    expect(isNaturalLanguagePlanBuildRequest("开始执行这个计划")).toBe(true);
    expect(isNaturalLanguagePlanBuildRequest("继续")).toBe(true);
    expect(isNaturalLanguagePlanBuildRequest("Start the build")).toBe(true);
  });

  it("does not treat plan feedback, questions, or negation as Build", () => {
    expect(isNaturalLanguagePlanBuildRequest("把跳跃高度再改一下")).toBe(false);
    expect(isNaturalLanguagePlanBuildRequest("计划改了吗？")).toBe(false);
    expect(isNaturalLanguagePlanBuildRequest("先不要开始 build")).toBe(false);
    expect(isNaturalLanguagePlanBuildRequest("可以开始了吗")).toBe(false);
  });

  it("finds the latest session-owned Plan snapshot including building plans", () => {
    const building = {
      ...payload,
      action: "updated",
      status: "building",
      todos: [
        { id: "one", content: "First task", status: "in_progress" },
        { id: "two", content: "Second task", status: "pending" },
      ],
    } satisfies PlanArtifactPayload;
    const messages = [
      { role: "tool", toolName: "plan_create", content: JSON.stringify(payload) },
      { role: "assistant", content: "Plan ready" },
      { role: "tool", toolName: "plan_update", content: JSON.stringify(building) },
    ];

    expect(findLatestPlanArtifact(messages, "session-1")).toEqual(building);
    expect(findLatestPlanArtifact(messages, "another-session")).toBeNull();
  });
});
