"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "@agenticx/ui";
import { useTranslations } from "next-intl";
import type { DepartmentTreeNode } from "@agenticx/feature-iam";
import { ChevronDown, ChevronRight, FolderTree, RefreshCw } from "lucide-react";

import { adminFetch } from "../../lib/admin-client-auth";

export type ApiDept = {
  id: string;
  tenantId: string;
  orgId: string;
  parentId: string | null;
  name: string;
  path: string;
  memberCount?: number;
  createdAt: string;
  updatedAt: string;
  children?: ApiDept[];
};

export type ApiEnvelope<T> = { code: string; message: string; data?: T };

export function mapApiToNode(n: ApiDept): DepartmentTreeNode {
  return {
    id: n.id,
    tenantId: n.tenantId,
    parentId: n.parentId,
    name: n.name,
    path: n.path,
    memberCount: n.memberCount ?? 0,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    children: (n.children ?? []).map(mapApiToNode),
  };
}

export function findNode(nodes: DepartmentTreeNode[], id: string): DepartmentTreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const c = findNode(n.children, id);
    if (c) return c;
  }
  return null;
}

export function collectAllIds(nodes: DepartmentTreeNode[]): string[] {
  const ids: string[] = [];
  for (const n of nodes) {
    ids.push(n.id);
    if (n.children.length) ids.push(...collectAllIds(n.children));
  }
  return ids;
}

export function TreeNode({
  node,
  depth,
  selectedId,
  expandedIds,
  onSelect,
  onToggle,
  showZeroCount = false,
}: {
  node: DepartmentTreeNode;
  depth: number;
  selectedId: string | null;
  expandedIds: Set<string>;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  showZeroCount?: boolean;
}) {
  const isExpanded = expandedIds.has(node.id);
  const isSelected = selectedId === node.id;
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <button
        type="button"
        onClick={() => { onSelect(node.id); if (hasChildren) onToggle(node.id); }}
        style={{ paddingLeft: `${4 + depth * 14}px` }}
        className={[
          "group flex w-full items-center gap-1.5 rounded-lg py-1.5 pr-2 text-left text-sm transition-colors",
          isSelected
            ? "bg-primary/10 font-semibold text-primary"
            : "text-foreground/80 hover:bg-muted hover:text-foreground",
        ].join(" ")}
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
          {hasChildren ? (
            isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )
          ) : (
            <span className="h-3.5 w-3.5" />
          )}
        </span>

        <FolderTree
          className={[
            "h-3.5 w-3.5 shrink-0",
            isSelected ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
          ].join(" ")}
        />

        <span className="min-w-0 flex-1 truncate">{node.name}</span>

        {(showZeroCount || node.memberCount > 0) && (
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground">
            {node.memberCount}
          </span>
        )}
      </button>

      {isExpanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              expandedIds={expandedIds}
              onSelect={onSelect}
              onToggle={onToggle}
              showZeroCount={showZeroCount}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterRow({
  label,
  selected,
  onClick,
  bordered,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  bordered?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex w-full shrink-0 items-center px-3 py-2.5 text-left text-sm",
        bordered ? "border-t border-border" : "border-b border-border",
        selected
          ? "bg-primary/10 font-semibold text-primary"
          : "text-foreground/80 hover:bg-muted hover:text-foreground",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

export function DepartmentTree({
  selectedId,
  onSelect,
  refreshKey = 0,
}: {
  selectedId: string;
  onSelect: (id: string) => void;
  refreshKey?: number;
}) {
  const t = useTranslations("pages.iam.members");
  const td = useTranslations("pages.iam.departments");
  const [tree, setTree] = useState<DepartmentTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const loadTree = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch("/api/admin/departments?shape=tree", { cache: "no-store" });
      const json = (await res.json()) as ApiEnvelope<{ shape: string; items: ApiDept[] }>;
      if (!res.ok || !json.data?.items) {
        toast.error(json.message ?? td("toast.loadFailed"));
        return;
      }
      const nodes = json.data.items.map(mapApiToNode);
      setTree(nodes);
      setExpandedIds(new Set(collectAllIds(nodes)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : td("toast.networkError"));
    } finally {
      setLoading(false);
    }
  }, [td]);

  useEffect(() => {
    void loadTree();
  }, [loadTree, refreshKey]);

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const nodeSelectedId = selectedId === "all" || selectedId === "unassigned" ? null : selectedId;

  return (
    <aside className="flex max-h-[calc(100vh-8rem)] w-full shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card lg:sticky lg:top-4 lg:w-[220px]">
      <FilterRow label={t("allMembers")} selected={selectedId === "all"} onClick={() => onSelect("all")} />
      <nav className="min-h-0 flex-1 overflow-y-auto py-2 pl-1 pr-1">
        {loading ? (
          <div className="mt-4 flex items-center justify-center text-xs text-muted-foreground">
            <RefreshCw className="mr-1.5 h-3 w-3 animate-spin" />
            {td("loading")}
          </div>
        ) : (
          tree.map((node) => (
            <TreeNode
              key={node.id}
              node={node}
              depth={0}
              selectedId={nodeSelectedId}
              expandedIds={expandedIds}
              onSelect={onSelect}
              onToggle={toggleExpand}
              showZeroCount
            />
          ))
        )}
      </nav>
      <FilterRow
        label={t("unassigned")}
        selected={selectedId === "unassigned"}
        onClick={() => onSelect("unassigned")}
        bordered
      />
    </aside>
  );
}
