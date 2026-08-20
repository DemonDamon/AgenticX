"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "@agenticx/ui";

import { adminFetch } from "../../lib/admin-client-auth";
import { featureCapabilityId, PLATFORM_FEATURES } from "@agenticx/config";

import {
  groupCapabilityChoices,
  mcpCapabilityId,
  skillCapabilityId,
  type CapabilityChoice,
} from "../../lib/capability-pack-form";

/** 平台功能是常量，不来自数据库；名字和说明写死在这里，id 仍走统一入口构造。 */
const FEATURE_LABELS: Record<
  (typeof PLATFORM_FEATURES)[number],
  { displayName: string; description: string }
> = {
  web_search: {
    displayName: "联网搜索",
    description: "对话中检索公网信息。搜索服务商和 Key 在「联网搜索」页配置，这里管的是谁能用。",
  },
  deep_research: {
    displayName: "深度研究",
    description: "多轮检索加汇总成文的长任务，比单次搜索更费额度。",
  },
  attachment_routing: {
    displayName: "附件自动路由",
    description:
      "检测到文档就把会话锁到私有化部署的多模态模型，之后整段对话都留在私有部署里；图片走视觉兜底，不切模型。",
  },
};

/** MCP 卡片上没有说明可显示，就说它连到哪儿去——这正是管理员想确认的那件事。 */
function mcpConnectionSummary(server: McpServerRow): string {
  const config = (server.backendConfig ?? {}) as {
    endpoint?: unknown;
    command?: unknown;
    args?: unknown;
  };
  if (typeof config.endpoint === "string" && config.endpoint) return config.endpoint;
  if (typeof config.command === "string" && config.command) {
    const args = Array.isArray(config.args) ? config.args.map(String) : [];
    return [config.command, ...args].join(" ");
  }
  return "";
}

export type CapabilityStatus = "active" | "disabled";

export type SkillRecord = {
  id: string;
  slug: string;
  displayName: string;
  description: string;
  version: string;
  bundleUri: string;
  bundleDigest: string;
  requiredCapabilities: string[];
  status: CapabilityStatus;
  /** null = 从未扫过（手工登记的技能）。和「扫过且安全」是两回事。 */
  scanVerdict?: string | null;
  scannedAt?: string | null;
  scanFindings?: unknown[];
};

export type PackRecord = {
  id: string;
  slug: string;
  displayName: string;
  description: string;
  status: CapabilityStatus;
  capabilityIds: string[];
  assignmentKeys: string[];
};

export type McpServerRow = {
  id: string;
  name: string;
  displayName: string;
  status: string;
  backendConfig?: unknown;
};
export type DeptRow = { id: string; name: string; path: string };
export type UserRow = { id: string; email: string; displayName?: string };
export type GroupRow = { id: string; name: string; memberIds: string[] };

/**
 * 能力包与 Skill 两个面板共用的数据源。
 *
 * 成员勾选要同时看到 MCP 服务器和 Skill，分配范围要看到部门和人；这些请求拆到各自
 * 面板里会让两边对「现在有哪些能力」看到不同的答案。
 */
export function useCapabilityCatalog(loadFailedMessage: string, errorMessage: string) {
  const [packs, setPacks] = useState<PackRecord[]>([]);
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServerRow[]>([]);
  const [depts, setDepts] = useState<DeptRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(true);

  const choices: CapabilityChoice[] = useMemo(() => {
    const mcp = mcpServers.map((server) => ({
      id: mcpCapabilityId(server.id),
      kind: "mcp" as const,
      name: server.name,
      displayName: server.displayName || server.name,
      disabled: server.status !== "active",
      description: mcpConnectionSummary(server),
    }));
    const skillChoices = skills.map((skill) => ({
      id: skillCapabilityId(skill.id),
      kind: "skill" as const,
      name: skill.slug,
      displayName: skill.displayName || skill.slug,
      disabled: skill.status !== "active",
      description: skill.description,
    }));
    // 平台功能和 MCP/Skill 并列成为能力：「谁能用联网搜索」和「谁能用某个 MCP」
    // 是同一个问题，不该因为这一项是平台内置的就换一套分配系统。
    const featureChoices = PLATFORM_FEATURES.map((feature) => ({
      id: featureCapabilityId(feature),
      kind: "feature" as const,
      name: feature,
      displayName: FEATURE_LABELS[feature].displayName,
      disabled: false,
      description: FEATURE_LABELS[feature].description,
    }));
    return [...featureChoices, ...mcp, ...skillChoices];
  }, [mcpServers, skills]);

  const grouped = useMemo(() => groupCapabilityChoices(choices), [choices]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [packsRes, skillsRes, mcpRes, deptRes, userRes, groupRes] = await Promise.all([
        adminFetch("/api/admin/capability-packs", { cache: "no-store" }),
        adminFetch("/api/admin/skills", { cache: "no-store" }),
        adminFetch("/api/admin/mcp-servers", { cache: "no-store" }),
        adminFetch("/api/admin/departments?shape=flat", { cache: "no-store" }),
        adminFetch("/api/admin/users?limit=200", { cache: "no-store" }),
        adminFetch("/api/admin/user-groups", { cache: "no-store" }),
      ]);
      const packsJson = (await packsRes.json()) as {
        message?: string;
        data?: { packs?: PackRecord[] };
      };
      if (!packsRes.ok) throw new Error(packsJson.message || loadFailedMessage);
      setPacks(packsJson.data?.packs ?? []);

      const skillsJson = (await skillsRes.json()) as {
        message?: string;
        data?: { skills?: SkillRecord[] };
      };
      if (!skillsRes.ok) throw new Error(skillsJson.message || loadFailedMessage);
      setSkills(skillsJson.data?.skills ?? []);

      const mcpJson = (await mcpRes.json().catch(() => ({}))) as {
        data?: { servers?: McpServerRow[] };
        servers?: McpServerRow[];
      };
      setMcpServers(mcpJson.data?.servers ?? mcpJson.servers ?? []);

      const deptJson = (await deptRes.json().catch(() => ({}))) as { data?: { items?: DeptRow[] } };
      setDepts(deptJson.data?.items ?? []);

      const userJson = (await userRes.json().catch(() => ({}))) as { data?: { items?: UserRow[] } };
      setUsers(userJson.data?.items ?? []);

      const groupJson = (await groupRes.json().catch(() => ({}))) as { data?: { items?: GroupRow[] } };
      setGroups(groupJson.data?.items ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : loadFailedMessage);
    } finally {
      setLoading(false);
    }
  }, [loadFailedMessage]);

  useEffect(() => {
    void load();
  }, [load]);

  const send = useCallback(
    async (path: string, method: string, body?: unknown): Promise<boolean> => {
      try {
        const res = await adminFetch(path, {
          method,
          headers: { "content-type": "application/json" },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const json = (await res.json().catch(() => ({}))) as { message?: string };
        if (!res.ok) throw new Error(json.message || errorMessage);
        await load();
        return true;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : errorMessage);
        return false;
      }
    },
    [errorMessage, load],
  );

  return { packs, skills, mcpServers, depts, users, groups, choices, grouped, loading, load, send };
}

export function toggleId(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}
