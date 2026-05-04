import * as React from "react";
import type { DepartmentTreeNode } from "../types";

type DepartmentTreeProps = {
  nodes: DepartmentTreeNode[];
  onSelect?: (departmentId: string) => void;
  selectedDepartmentId?: string;
};

/** 18px chevron：树控件必须与部门名单列对齐且对比度足够（浅色主题下仍清晰可见）。 */
function ChevronCollapsed() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function ChevronExpanded() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function TreeNode({
  node,
  level,
  selectedDepartmentId,
  onSelect,
}: {
  node: DepartmentTreeNode;
  level: number;
  selectedDepartmentId?: string;
  onSelect?: (departmentId: string) => void;
}) {
  const [expanded, setExpanded] = React.useState(true);
  const children = node.children ?? [];
  const hasChildren = children.length > 0;
  const selected = selectedDepartmentId === node.id;

  const toggleBaseClass =
    "flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-zinc-800 dark:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-900";
  const toggleEnabledClass =
    `${toggleBaseClass} border-2 border-solid border-zinc-400 bg-white shadow-sm hover:bg-zinc-50 active:bg-zinc-100 dark:border-zinc-500 dark:bg-zinc-900 dark:hover:bg-zinc-800`;
  const toggleLeafClass =
    `${toggleBaseClass} cursor-default border-2 border-dashed border-zinc-300 bg-zinc-50 text-zinc-400 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-500`;

  return (
    <div>
      <div
        className={`flex items-center gap-2 rounded-md px-1 py-0.5 ${
          selected ? "bg-zinc-100 dark:bg-zinc-800" : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
        }`}
        style={{ paddingLeft: `${4 + level * 16}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            className={toggleEnabledClass}
            aria-expanded={expanded}
            aria-label={expanded ? "收起子部门" : "展开子部门"}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((value) => !value);
            }}
          >
            {expanded ? <ChevronExpanded /> : <ChevronCollapsed />}
          </button>
        ) : (
          <span className={toggleLeafClass} title="暂无子部门，可先新建子部门后再用此处展开" aria-hidden>
            <ChevronCollapsed />
          </span>
        )}
        <button
          type="button"
          className="flex min-h-9 flex-1 items-center justify-between gap-2 rounded-md px-1 py-1 text-left text-sm"
          onClick={() => onSelect?.(node.id)}
        >
          <span>{node.name}</span>
          <span className="text-xs text-zinc-500 tabular-nums">{node.memberCount}</span>
        </button>
      </div>
      {expanded &&
        children.map((child) => (
          <TreeNode
            key={child.id}
            node={child}
            level={level + 1}
            selectedDepartmentId={selectedDepartmentId}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}

export function DepartmentTree({ nodes, onSelect, selectedDepartmentId }: DepartmentTreeProps) {
  return (
    <div className="space-y-1">
      {nodes.map((node) => (
        <TreeNode key={node.id} node={node} level={0} selectedDepartmentId={selectedDepartmentId} onSelect={onSelect} />
      ))}
    </div>
  );
}

