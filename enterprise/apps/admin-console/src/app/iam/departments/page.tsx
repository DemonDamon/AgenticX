"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@agenticx/ui";
import { DepartmentTree, type DepartmentTreeNode } from "@agenticx/feature-iam";
import { useMemo, useState } from "react";

const mockDepartments: DepartmentTreeNode[] = [
  {
    id: "dept-root",
    tenantId: "tenant_default",
    parentId: null,
    name: "总经办",
    path: "/dept-root",
    memberCount: 2,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    children: [
      {
        id: "dept-ops",
        tenantId: "tenant_default",
        parentId: "dept-root",
        name: "运营中心",
        path: "/dept-root/dept-ops",
        memberCount: 12,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        children: [],
      },
      {
        id: "dept-audit",
        tenantId: "tenant_default",
        parentId: "dept-root",
        name: "风控审计",
        path: "/dept-root/dept-audit",
        memberCount: 6,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        children: [],
      },
    ],
  },
];

export default function DepartmentsPage() {
  const [selectedId, setSelectedId] = useState<string>("dept-root");
  const selected = useMemo(() => {
    const stack = [...mockDepartments];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) break;
      if (node.id === selectedId) return node;
      stack.push(...node.children);
    }
    return null;
  }, [selectedId]);

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <Card className="border-zinc-800 bg-[var(--machi-bg-elevated)]">
        <CardHeader>
          <CardTitle>部门树</CardTitle>
          <CardDescription>左树右详情布局</CardDescription>
        </CardHeader>
        <CardContent>
          <DepartmentTree nodes={mockDepartments} selectedDepartmentId={selectedId} onSelect={setSelectedId} />
        </CardContent>
      </Card>

      <Card className="border-zinc-800 bg-[var(--machi-bg-elevated)]">
        <CardHeader>
          <CardTitle>部门详情</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="rounded-lg border border-zinc-800 p-3">
            <p className="text-zinc-400">部门 ID</p>
            <p className="mt-1 font-medium">{selected?.id ?? "-"}</p>
          </div>
          <div className="rounded-lg border border-zinc-800 p-3">
            <p className="text-zinc-400">名称</p>
            <p className="mt-1 font-medium">{selected?.name ?? "-"}</p>
          </div>
          <div className="rounded-lg border border-zinc-800 p-3">
            <p className="text-zinc-400">成员数</p>
            <p className="mt-1 font-medium">{selected?.memberCount ?? 0}</p>
          </div>
          <div className="rounded-lg border border-zinc-800 p-3">
            <p className="text-zinc-400">层级路径</p>
            <p className="mt-1 font-medium">{selected?.path ?? "-"}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

