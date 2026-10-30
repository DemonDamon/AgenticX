import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";

import en from "../../../../../messages/en.json";
import zh from "../../../../../messages/zh.json";
import { isPlatformSection, PLATFORM_SECTION_IDS } from "../../../../lib/admin-platform-sections";

function stringLeaves(value: unknown, prefix = ""): string[] {
  if (typeof value === "string") return [prefix];
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) =>
    stringLeaves(item, prefix ? `${prefix}.${key}` : key),
  );
}

describe("agent schedules UI entry (H9)", () => {
  it("keeps en/zh agentSchedules key trees aligned", () => {
    const enKeys = stringLeaves(en.pages.admin.agentSchedules).sort();
    const zhKeys = stringLeaves(zh.pages.admin.agentSchedules).sort();
    expect(enKeys).toEqual(zhKeys);
    expect(enKeys).toContain("title");
    expect(enKeys).toContain("create");
    expect(enKeys).toContain("columns.name");
    expect(enKeys).toContain("actions.run");
    expect(enKeys).toContain("fields.inputHint");
  });

  it("exposes Chinese chrome for the schedules admin entry", () => {
    expect(zh.pages.admin.agentSchedules.title).toBe("定时任务");
    expect(zh.pages.admin.agentSchedules.create).toBe("新建定时任务");
    expect(zh.pages.admin.agentSchedules.emptyTitle).toBe("还没有定时任务");
    expect(zh.shell.nav.items.agentSchedules).toBe("定时任务");
    expect(en.shell.nav.items.agentSchedules).toBe("Schedules");
    const tZh = createTranslator({
      locale: "zh",
      messages: zh,
      namespace: "pages.admin.agentSchedules",
    });
    expect(tZh("title")).toBe("定时任务");
    expect(tZh("emptyTitle")).toContain("定时任务");
    expect(tZh("fields.inputHint")).toContain("{{date}}");
  });

  it("registers agent-schedules as a platform admin section (nav href /admin/agent-schedules)", () => {
    expect(PLATFORM_SECTION_IDS).toContain("agent-schedules");
    expect(isPlatformSection("agent-schedules")).toBe(true);
  });
});
