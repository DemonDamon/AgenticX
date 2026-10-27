import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";

import en from "../../../../../messages/en.json";
import zh from "../../../../../messages/zh.json";

function stringLeaves(value: unknown, prefix = ""): string[] {
  if (typeof value === "string") return [prefix];
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) =>
    stringLeaves(item, prefix ? `${prefix}.${key}` : key),
  );
}

describe("agent evals messages", () => {
  it("keeps en/zh agentEvals key trees aligned", () => {
    const enKeys = stringLeaves(en.pages.admin.agentEvals).sort();
    const zhKeys = stringLeaves(zh.pages.admin.agentEvals).sort();
    expect(enKeys).toEqual(zhKeys);
    expect(enKeys).toContain("actions.createDataset");
    expect(enKeys).toContain("actions.startRun");
    expect(enKeys).toContain("columns.agentVersion");
    expect(enKeys).toContain("detail.errorNote");
  });

  it("uses English chrome for en and Chinese for zh on E2E-visible labels", () => {
    expect(en.pages.admin.agentEvals.actions.createDataset).toBe("New dataset");
    expect(zh.pages.admin.agentEvals.actions.createDataset).toBe("新建评测集");
    expect(en.pages.admin.agentEvals.actions.startRun).toBe("Start evaluation");
    expect(zh.pages.admin.agentEvals.actions.startRun).toBe("发起评测");
    expect(en.pages.admin.agentEvals.columns.name).toBe("Name");
    expect(zh.pages.admin.agentEvals.columns.name).toBe("名称");
    expect(en.pages.admin.agentEvals.columns.agentVersion).toBe("Agent & version");
    expect(zh.pages.admin.agentEvals.columns.agentVersion).toBe("智能体与版本");
  });

  it("formats schedule inputHint without leaking the raw key", () => {
    const tEn = createTranslator({ locale: "en", messages: en, namespace: "pages.admin.agentSchedules" });
    const tZh = createTranslator({ locale: "zh", messages: zh, namespace: "pages.admin.agentSchedules" });
    expect(tEn("fields.inputHint")).toContain("{{date}}");
    expect(tEn("fields.inputHint")).not.toContain("pages.admin.agentSchedules");
    expect(tZh("fields.inputHint")).toContain("{{date}}");
    expect(tZh("fields.inputHint")).not.toContain("pages.admin.agentSchedules");
  });

  it("joins agent usage caption with locale-correct punctuation", () => {
    expect(en.pages.metering.agents.captionJoin).toBe(". ");
    expect(zh.pages.metering.agents.captionJoin).toBe("。");
    expect(en.pages.metering.agents.captionLead).not.toContain("。");
    expect(zh.pages.metering.agents.empty.length).toBeGreaterThan(0);
    expect(en.pages.metering.agents.empty.length).toBeGreaterThan(0);
  });
});
