import { describe, expect, it } from "vitest";
import { MessageSquareText } from "lucide-react";

import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { NAV_GROUPS } from "../AppShell";

const EVALS_ENABLED = process.env.NEXT_PUBLIC_MA_EVALS_UI_ENABLED === "1";

const AGENT_RUNTIME_HREFS = [
  "/admin/agents",
  "/ops/logs/managed",
  ...(EVALS_ENABLED ? ["/admin/agent-evals"] : []),
  "/admin/agent-schedules",
  "/metering/agents",
];

const AGENT_RESOURCES_HREFS = [
  "/admin/agent-environments",
  "/admin/agent-vaults",
  "/admin/agent-memory",
  "/admin/agent-webhooks",
  "/admin/agent-channels",
];

const PLATFORM_HREFS = [
  "/policy",
  "/admin/models",
  "/admin/channels",
  "/admin/cache",
  "/admin/api-tokens",
  "/admin/mcp-servers",
  "/admin/connectors",
  "/admin/capabilities",
  "/admin/plugins",
];

function stringRecord(value: object): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") out[key] = item;
  }
  return out;
}

describe("admin navigation groups", () => {
  it("has a label for every group and item in zh and en", () => {
    const zhGroups = stringRecord(zh.shell.nav.groups);
    const enGroups = stringRecord(en.shell.nav.groups);
    const zhItems = stringRecord(zh.shell.nav.items);
    const enItems = stringRecord(en.shell.nav.items);

    for (const group of NAV_GROUPS) {
      expect(zhGroups[group.id]?.trim().length).toBeGreaterThan(0);
      expect(enGroups[group.id]?.trim().length).toBeGreaterThan(0);
      for (const item of group.items) {
        expect(zhItems[item.labelKey]?.trim().length).toBeGreaterThan(0);
        expect(enItems[item.labelKey]?.trim().length).toBeGreaterThan(0);
      }
    }

    expect(zhGroups.agentRuntime).toBe("智能体运行");
    expect(zhGroups.agentResources).toBe("资源配置");
    expect(zhItems.agentSessions).toBe("会话");
    expect(enGroups.agentRuntime).toBe("Agent runtime");
    expect(enGroups.agentResources).toBe("Agent resources");
    expect(enItems.agentSessions).toBe("Sessions");
  });

  it("splits agent runtime and resources out of platform", () => {
    expect(NAV_GROUPS.map((group) => group.id)).toEqual([
      "overview",
      "iam",
      "ops",
      "agentRuntime",
      "agentResources",
      "platform",
      "content",
    ]);

    const runtime = NAV_GROUPS.find((group) => group.id === "agentRuntime");
    const resources = NAV_GROUPS.find((group) => group.id === "agentResources");
    const platform = NAV_GROUPS.find((group) => group.id === "platform");
    const ops = NAV_GROUPS.find((group) => group.id === "ops");

    expect(runtime?.items.map((item) => item.href)).toEqual(AGENT_RUNTIME_HREFS);
    expect(runtime?.items.find((item) => item.labelKey === "agentSessions")?.icon).toBe(MessageSquareText);
    expect(resources?.items.map((item) => item.href)).toEqual(AGENT_RESOURCES_HREFS);
    expect(platform?.items.map((item) => item.href)).toEqual(PLATFORM_HREFS);
    expect(ops?.items.map((item) => item.href)).not.toContain("/metering/agents");
    expect(platform?.items.map((item) => item.href).some((href) => href.startsWith("/admin/agent"))).toBe(false);
  });
});
