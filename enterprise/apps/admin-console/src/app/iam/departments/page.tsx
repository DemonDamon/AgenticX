"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Badge,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  PageHeader,
  Separator,
} from "@agenticx/ui";
import { DepartmentTree, type DepartmentTreeNode } from "@agenticx/feature-iam";
import { Building2, Clock, GitBranch, Pencil, Plus, Search, Users } from "lucide-react";

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
        children: [
          {
            id: "dept-ops-sales",
            tenantId: "tenant_default",
            parentId: "dept-ops",
            name: "销售组",
            path: "/dept-root/dept-ops/dept-ops-sales",
            memberCount: 5,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            children: [],
          },
        ],
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
      {
        id: "dept-tech",
        tenantId: "tenant_default",
        parentId: "dept-root",
        name: "技术中心",
        path: "/dept-root/dept-tech",
        memberCount: 24,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        children: [],
      },
    ],
  },
];

function flatten(nodes: DepartmentTreeNode[]): DepartmentTreeNode[] {
  const out: DepartmentTreeNode[] = [];
  const stack = [...nodes];
  while (stack.length) {
    const node = stack.pop();
    if (!node) break;
    out.push(node);
    stack.push(...node.children);
  }
  return out;
}

export default function DepartmentsPage() {
  const [selectedId, setSelectedId] = useState<string>("dept-root");
  const [keyword, setKeyword] = useState("");
  const flat = useMemo(() => flatten(mockDepartments), []);

  const totalMembers = flat.reduce((sum, node) => sum + node.memberCount, 0);

  const selected = useMemo(() => flat.find((node) => node.id === selectedId) ?? null, [flat, selectedId]);

  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumb={
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link href="/dashboard">Admin</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>身份与权限</BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>部门</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        title="部门与组织架构"
        description={`共 ${flat.length} 个部门 · ${totalMembers} 名成员`}
        actions={
          <>
            <Button variant="outline" size="sm">
              <GitBranch />
              导出结构
            </Button>
            <Button size="sm">
              <Plus />
              新建部门
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        {/* 左：部门树 */}
        <Card className="flex h-[calc(100vh-260px)] min-h-[480px] flex-col overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">部门结构</CardTitle>
            <div className="relative mt-2">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="搜索部门..."
                className="pl-8 h-9"
              />
            </div>
          </CardHeader>
          <Separator />
          <CardContent className="flex-1 overflow-y-auto py-3">
            <DepartmentTree
              nodes={mockDepartments}
              selectedDepartmentId={selectedId}
              onSelect={setSelectedId}
            />
          </CardContent>
        </Card>

        {/* 右：详情 */}
        {selected ? (
          <div className="space-y-4">
            <Card>
              <CardContent className="flex items-center justify-between gap-4 p-5">
                <div className="flex items-center gap-3">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                    <Building2 className="h-6 w-6" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-semibold">{selected.name}</h2>
                    <p className="truncate font-mono text-xs text-muted-foreground">{selected.id}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm">
                    <Pencil />
                    编辑
                  </Button>
                  <Button variant="outline" size="sm">
                    <Plus />
                    子部门
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4 sm:grid-cols-2">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    成员数
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex items-baseline gap-2">
                  <span className="text-3xl font-semibold">{selected.memberCount}</span>
                  <Badge variant="soft" className="gap-1">
                    <Users className="h-3 w-3" />
                    含子部门
                  </Badge>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    子部门
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <span className="text-3xl font-semibold">{selected.children.length}</span>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">部门信息</CardTitle>
              </CardHeader>
              <CardContent className="divide-y divide-border">
                <InfoRow label="层级路径" value={<span className="font-mono text-xs">{selected.path}</span>} />
                <InfoRow label="上级部门" value={selected.parentId ?? "根部门"} />
                <InfoRow
                  label="租户"
                  value={<span className="font-mono text-xs">{selected.tenantId}</span>}
                />
                <InfoRow
                  label="创建时间"
                  value={
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      {new Date(selected.createdAt).toLocaleString("zh-CN", { hour12: false })}
                    </span>
                  }
                />
                <InfoRow
                  label="更新时间"
                  value={
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      {new Date(selected.updatedAt).toLocaleString("zh-CN", { hour12: false })}
                    </span>
                  }
                />
              </CardContent>
            </Card>
          </div>
        ) : (
          <Card>
            <CardContent className="py-16">
              <EmptyState
                icon={<Building2 className="h-5 w-5" />}
                title="请选择一个部门"
                description="从左侧树选择部门以查看详情"
                size="sm"
                className="border-0"
              />
            </CardContent>
          </Card>
        )}
      </div>

      {keyword.trim() ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">搜索结果</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {flat
              .filter((node) => node.name.toLowerCase().includes(keyword.toLowerCase()))
              .map((node) => (
                <Button
                  key={node.id}
                  variant={node.id === selectedId ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedId(node.id)}
                >
                  {node.name}
                  <Badge variant="soft" className="ml-1">
                    {node.memberCount}
                  </Badge>
                </Button>
              ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] items-center gap-3 py-2.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 text-foreground">{value}</span>
    </div>
  );
}
