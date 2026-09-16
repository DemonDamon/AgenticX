"use client";

import { Checkbox, Switch } from "@agenticx/ui";
import { useTranslations } from "next-intl";

import { toAssignmentKeys, type AssignmentDraft } from "../../lib/capability-pack-form";
import type { DeptRow, GroupRow, UserRow } from "./useAssignmentDirectory";

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

/**
 * 分配范围选择器：全员 / 部门 / 用户组 / 指定人。
 *
 * 能力包、联网搜索、深度研究共用这一个组件和同一套键（`all` / `dept:` / `group:` /
 * 用户 ulid）。每个功能各做一套选择器，管理员就得记住三种略有差别的规则。
 */
export function AssignmentScopeEditor({
  value,
  onChange,
  depts,
  groups,
  users,
}: {
  value: AssignmentDraft;
  onChange: (next: AssignmentDraft) => void;
  depts: DeptRow[];
  groups: GroupRow[];
  users: UserRow[];
}) {
  const t = useTranslations("pages.admin.capabilityPacks.assignment");

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm">
        <Switch
          checked={value.allMembers}
          onCheckedChange={(checked) => onChange({ ...value, allMembers: Boolean(checked) })}
        />
        <span>{t("allMembers")}</span>
      </label>
      {value.allMembers ? (
        <p className="text-xs text-muted-foreground">{t("allMembersHint")}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2 rounded-lg border p-3">
            <div className="text-xs font-medium text-muted-foreground">{t("departments")}</div>
            {depts.length === 0 && (
              <p className="text-xs text-muted-foreground">{t("noDept")}</p>
            )}
            {depts.map((dept) => (
              <label key={dept.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={value.deptIds.includes(dept.id)}
                  onCheckedChange={() =>
                    onChange({ ...value, deptIds: toggle(value.deptIds, dept.id) })
                  }
                />
                <span>{dept.name}</span>
                <span className="text-xs text-muted-foreground">{dept.path}</span>
              </label>
            ))}
            <p className="text-xs text-muted-foreground">{t("deptHint")}</p>
          </div>
          <div className="space-y-2 rounded-lg border p-3">
            <div className="text-xs font-medium text-muted-foreground">{t("groups")}</div>
            {groups.length === 0 && (
              <p className="text-xs text-muted-foreground">{t("noGroup")}</p>
            )}
            {groups.map((group) => (
              <label key={group.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={value.groupIds.includes(group.id)}
                  onCheckedChange={() =>
                    onChange({ ...value, groupIds: toggle(value.groupIds, group.id) })
                  }
                />
                <span>{group.name}</span>
                <span className="text-xs text-muted-foreground">
                  {t("groupMemberCount", { count: group.memberIds.length })}
                </span>
              </label>
            ))}
            <p className="text-xs text-muted-foreground">{t("groupHint")}</p>
          </div>
          <div className="space-y-2 rounded-lg border p-3">
            <div className="text-xs font-medium text-muted-foreground">{t("users")}</div>
            {users.length === 0 && (
              <p className="text-xs text-muted-foreground">{t("noUser")}</p>
            )}
            {users.map((user) => (
              <label key={user.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={value.userIds.includes(user.id)}
                  onCheckedChange={() =>
                    onChange({ ...value, userIds: toggle(value.userIds, user.id) })
                  }
                />
                <span>{user.displayName || user.email}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export { toAssignmentKeys };
