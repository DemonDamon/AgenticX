"use client";

import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@agenticx/ui";

const mockUsers = [
  { id: "u_001", email: "owner@agenticx.local", displayName: "企业 Owner", dept: "总经办", status: "active" },
  { id: "u_002", email: "ops@agenticx.local", displayName: "运营管理员", dept: "运营中心", status: "active" },
  { id: "u_003", email: "audit@agenticx.local", displayName: "审计员", dept: "风控审计", status: "disabled" },
];

export default function UsersPage() {
  const [keyword, setKeyword] = useState("");
  const [dept, setDept] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const rows = useMemo(
    () =>
      mockUsers.filter(
        (item) =>
          (!keyword || item.email.includes(keyword) || item.displayName.includes(keyword)) &&
          (!dept || item.dept.includes(dept))
      ),
    [keyword, dept]
  );
  const selected = rows.find((item) => item.id === selectedId) ?? null;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">用户管理</h2>
        <p className="text-sm text-zinc-400">shadcn-admin 风格重塑：筛选、列表、详情抽屉</p>
      </div>

      <Card className="border-zinc-800 bg-[var(--machi-bg-elevated)]">
        <CardHeader>
          <CardTitle>筛选</CardTitle>
          <CardDescription>按邮箱/姓名/部门快速过滤</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="w-72 space-y-1">
            <Label htmlFor="email">邮箱关键字</Label>
            <Input id="email" placeholder="例如 owner@agenticx.local" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
          </div>
          <div className="w-56 space-y-1">
            <Label htmlFor="dept">部门</Label>
            <Input id="dept" placeholder="例如 运营中心" value={dept} onChange={(event) => setDept(event.target.value)} />
          </div>
          <Button onClick={() => undefined}>查询</Button>
        </CardContent>
      </Card>

      <Card className="border-zinc-800 bg-[var(--machi-bg-elevated)]">
        <CardHeader>
          <CardTitle>用户列表 ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>用户 ID</TableHead>
                <TableHead>邮箱</TableHead>
                <TableHead>姓名</TableHead>
                <TableHead>部门</TableHead>
                <TableHead>状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((user) => (
                <TableRow key={user.id} className="cursor-pointer" onClick={() => setSelectedId(user.id)}>
                  <TableCell>{user.id}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>{user.displayName}</TableCell>
                  <TableCell>{user.dept}</TableCell>
                  <TableCell>
                    <Badge variant={user.status === "active" ? "success" : "warning"}>{user.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DialogContent className="border-zinc-700 bg-zinc-950">
          <DialogHeader>
            <DialogTitle>用户详情</DialogTitle>
            <DialogDescription>{selected?.email}</DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="space-y-2 text-sm">
              <div>ID：{selected.id}</div>
              <div>姓名：{selected.displayName}</div>
              <div>部门：{selected.dept}</div>
              <div>状态：{selected.status}</div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

