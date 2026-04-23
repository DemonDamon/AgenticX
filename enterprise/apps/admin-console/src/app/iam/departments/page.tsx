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
    <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>部门树</CardTitle>
          <CardDescription>接入 `@agenticx/feature-iam` 的 Tree 组件。</CardDescription>
        </CardHeader>
        <CardContent>
          <DepartmentTree nodes={mockDepartments} selectedDepartmentId={selectedId} onSelect={setSelectedId} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>部门详情</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div>部门 ID：{selected?.id ?? "-"}</div>
          <div>名称：{selected?.name ?? "-"}</div>
          <div>成员数：{selected?.memberCount ?? 0}</div>
          <div>层级路径：{selected?.path ?? "-"}</div>
        </CardContent>
      </Card>
    </div>
  );
}

