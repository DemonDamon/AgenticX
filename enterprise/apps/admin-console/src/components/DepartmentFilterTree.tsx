"use client";

import { useMemo, useState } from "react";
import { Button } from "@agenticx/ui";
import { Building2, ChevronDown, ChevronRight, SlidersHorizontal } from "lucide-react";

export type OrganizationNode = {
  id: string;
  name: string;
  parentId: string | null;
  path: string;
  memberCount: number;
};

/** 全部 / 未归属 这两档不是部门，用哨兵值表示，避免和真实部门 id 混。 */
export const ALL_DEPARTMENTS = "__all__";
export const NO_DEPARTMENT = "__none__";

export type DepartmentFilter = typeof ALL_DEPARTMENTS | typeof NO_DEPARTMENT | string;

function childrenByParent(nodes: readonly OrganizationNode[]) {
  const map = new Map<string | null, OrganizationNode[]>();
  const ids = new Set(nodes.map((node) => node.id));
  for (const node of nodes) {
    const parent = node.parentId && ids.has(node.parentId) ? node.parentId : null;
    const siblings = map.get(parent) ?? [];
    siblings.push(node);
    map.set(parent, siblings);
  }
  for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  return map;
}

/**
 * 选中一个部门时，子部门的人也要算进来。
 *
 * 管理员点「研发中心」想看的是研发中心所有人，不是只有直挂在这一层的那几个——
 * 按部门树管人的时候，父节点天然代表整棵子树。
 */
export function departmentSubtreeIds(
  nodes: readonly OrganizationNode[],
  rootId: string,
): Set<string> {
  const children = childrenByParent(nodes);
  const out = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || out.has(current)) continue;
    out.add(current);
    for (const child of children.get(current) ?? []) stack.push(child.id);
  }
  return out;
}

function Branch({
  node,
  children,
  selected,
  onSelect,
  onConfigureModels,
  depth,
}: {
  node: OrganizationNode;
  children: Map<string | null, OrganizationNode[]>;
  selected: DepartmentFilter;
  onSelect: (value: DepartmentFilter) => void;
  onConfigureModels: (node: OrganizationNode) => void;
  depth: number;
}) {
  const childNodes = children.get(node.id) ?? [];
  const [open, setOpen] = useState(depth < 1);
  const isSelected = selected === node.id;

  return (
    <div>
      <div
        className={`group flex items-center gap-1 rounded-md pr-1 text-sm ${
          isSelected ? "bg-muted font-medium" : "hover:bg-muted/60"
        }`}
        style={{ paddingLeft: `${4 + depth * 14}px` }}
      >
        {childNodes.length > 0 ? (
          <button
            type="button"
            aria-label={open ? "收起" : "展开"}
            className="shrink-0 rounded p-0.5 hover:bg-muted"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <button
          type="button"
          className="min-w-0 flex-1 truncate py-1.5 text-left"
          onClick={() => onSelect(node.id)}
          title={node.path}
        >
          {node.name}
        </button>
        <span className="shrink-0 text-xs text-muted-foreground">{node.memberCount}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          title="配置该部门的模型上限与额度"
          onClick={() => onConfigureModels(node)}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
        </Button>
      </div>
      {open
        ? childNodes.map((child) => (
            <Branch
              key={child.id}
              node={child}
              children={children}
              selected={selected}
              onSelect={onSelect}
              onConfigureModels={onConfigureModels}
              depth={depth + 1}
            />
          ))
        : null}
    </div>
  );
}

/**
 * 成员列表左栏的部门筛选器。
 *
 * 部门管理原本是一个独立菜单，日常根本不会天天点；但部门是模型可见性的天花板，配置
 * 入口不能跟着菜单一起消失。挂在这里：点部门筛人是高频操作，顺手就能改这个部门的上限。
 */
export function DepartmentFilterTree({
  nodes,
  selected,
  onSelect,
  onConfigureModels,
  totalCount,
  unassignedCount,
}: {
  nodes: readonly OrganizationNode[];
  selected: DepartmentFilter;
  onSelect: (value: DepartmentFilter) => void;
  onConfigureModels: (node: OrganizationNode) => void;
  totalCount: number;
  unassignedCount: number;
}) {
  const children = useMemo(() => childrenByParent(nodes), [nodes]);
  const roots = children.get(null) ?? [];

  // 只有一个顶级部门、又没有未归属的人时，「全部成员」和那个部门点下去结果一模一样。
  // 两行显示同一个数字、筛出同一批人，是纯噪音——这种时候只留部门那一行（它还带着
  // 模型上限和额度的入口），把「全部成员」隐掉。
  const allMembersIsRedundant = roots.length === 1 && unassignedCount === 0;

  return (
    <div className="space-y-0.5">
      {allMembersIsRedundant ? null : (
      <button
        type="button"
        className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm ${
          selected === ALL_DEPARTMENTS ? "bg-muted font-medium" : "hover:bg-muted/60"
        }`}
        onClick={() => onSelect(ALL_DEPARTMENTS)}
      >
        <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">全部成员</span>
        <span className="text-xs text-muted-foreground">{totalCount}</span>
      </button>
      )}
      {roots.map((node) => (
        <Branch
          key={node.id}
          node={node}
          children={children}
          selected={allMembersIsRedundant && selected === ALL_DEPARTMENTS ? node.id : selected}
          onSelect={onSelect}
          onConfigureModels={onConfigureModels}
          depth={0}
        />
      ))}
      {unassignedCount > 0 ? (
        <button
          type="button"
          className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm ${
            selected === NO_DEPARTMENT ? "bg-muted font-medium" : "hover:bg-muted/60"
          }`}
          onClick={() => onSelect(NO_DEPARTMENT)}
        >
          <span className="w-3.5" />
          <span className="min-w-0 flex-1 truncate text-muted-foreground">未归属组织</span>
          <span className="text-xs text-muted-foreground">{unassignedCount}</span>
        </button>
      ) : null}
    </div>
  );
}
