"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "@agenticx/ui";

import { adminFetch } from "../../lib/admin-client-auth";
import {
  groupCapabilityChoices,
  mcpCapabilityId,
  skillCapabilityId,
  type CapabilityChoice,
} from "../../lib/capability-pack-form";

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

export type McpServerRow = { id: string; name: string; displayName: string; status: string };
export type DeptRow = { id: string; name: string; path: string };
export type UserRow = { id: string; email: string; displayName?: string };

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
  const [loading, setLoading] = useState(true);

  const choices: CapabilityChoice[] = useMemo(() => {
    const mcp = mcpServers.map((server) => ({
      id: mcpCapabilityId(server.id),
      kind: "mcp" as const,
      name: server.name,
      displayName: server.displayName || server.name,
      disabled: server.status !== "active",
    }));
    const skillChoices = skills.map((skill) => ({
      id: skillCapabilityId(skill.id),
      kind: "skill" as const,
      name: skill.slug,
      displayName: skill.displayName || skill.slug,
      disabled: skill.status !== "active",
    }));
    return [...mcp, ...skillChoices];
  }, [mcpServers, skills]);

  const grouped = useMemo(() => groupCapabilityChoices(choices), [choices]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [packsRes, skillsRes, mcpRes, deptRes, userRes] = await Promise.all([
        adminFetch("/api/admin/capability-packs", { cache: "no-store" }),
        adminFetch("/api/admin/skills", { cache: "no-store" }),
        adminFetch("/api/admin/mcp-servers", { cache: "no-store" }),
        adminFetch("/api/admin/departments?shape=flat", { cache: "no-store" }),
        adminFetch("/api/admin/users?limit=200", { cache: "no-store" }),
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

  return { packs, skills, mcpServers, depts, users, choices, grouped, loading, load, send };
}

export function toggleId(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}
