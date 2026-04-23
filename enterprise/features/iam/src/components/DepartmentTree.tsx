import * as React from "react";
import type { DepartmentTreeNode } from "../types";
import { Button } from "@agenticx/ui";

type DepartmentTreeProps = {
  nodes: DepartmentTreeNode[];
  onSelect?: (departmentId: string) => void;
  selectedDepartmentId?: string;
};

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
  const hasChildren = node.children.length > 0;
  const selected = selectedDepartmentId === node.id;

  return (
    <div>
      <div
        className={`flex items-center gap-2 rounded-md px-2 py-1 ${
          selected ? "bg-zinc-100 dark:bg-zinc-800" : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
        }`}
        style={{ paddingLeft: `${8 + level * 16}px` }}
      >
        {hasChildren ? (
          <Button size="sm" variant="ghost" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "▾" : "▸"}
          </Button>
        ) : (
          <span className="inline-block w-6" />
        )}
        <button
          type="button"
          className="flex flex-1 items-center justify-between text-left text-sm"
          onClick={() => onSelect?.(node.id)}
        >
          <span>{node.name}</span>
          <span className="text-xs text-zinc-500">{node.memberCount}</span>
        </button>
      </div>
      {expanded &&
        node.children.map((child) => (
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

