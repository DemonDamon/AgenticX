"use client";

import { useCallback, useEffect, useState } from "react";

import { adminFetch } from "../../lib/admin-client-auth";

export type DeptRow = { id: string; name: string; path: string };
export type GroupRow = { id: string; name: string; memberIds: string[] };
export type UserRow = { id: string; email: string; displayName?: string };

/**
 * 分配范围选择器需要的名录：部门、用户组、人。
 *
 * 三个请求各自失败都只让对应那一栏空着，不阻断整个页面——部门读取要 dept:read、
 * 用户组要 user:read，而调用方的页面可能只有 provider:* 权限。
 */
export function useAssignmentDirectory() {
  const [depts, setDepts] = useState<DeptRow[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);

  const load = useCallback(async () => {
    const [deptRes, groupRes, userRes] = await Promise.all([
      adminFetch("/api/admin/departments?shape=flat", { cache: "no-store" }).catch(() => null),
      adminFetch("/api/admin/user-groups", { cache: "no-store" }).catch(() => null),
      adminFetch("/api/admin/users?limit=200", { cache: "no-store" }).catch(() => null),
    ]);
    const deptJson = (await deptRes?.json().catch(() => ({}))) as { data?: { items?: DeptRow[] } };
    setDepts(deptJson?.data?.items ?? []);
    const groupJson = (await groupRes?.json().catch(() => ({}))) as { data?: { items?: GroupRow[] } };
    setGroups(groupJson?.data?.items ?? []);
    const userJson = (await userRes?.json().catch(() => ({}))) as { data?: { items?: UserRow[] } };
    setUsers(userJson?.data?.items ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { depts, groups, users, reload: load };
}
