import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from "@agenticx/ui";

const mockUsers = [
  { id: "u_001", email: "owner@agenticx.local", displayName: "企业 Owner", dept: "总经办", status: "active" },
  { id: "u_002", email: "ops@agenticx.local", displayName: "运营管理员", dept: "运营中心", status: "active" },
  { id: "u_003", email: "audit@agenticx.local", displayName: "审计员", dept: "风控审计", status: "disabled" },
];

export default function UsersPage() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">用户管理</h2>
        <p className="text-sm text-zinc-500">已挂载 IAM 用户页面（W2-T09），W2-T10 将接入真实 auth + iam API。</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>筛选</CardTitle>
          <CardDescription>按邮箱/部门快速过滤（当前为前端占位）。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="w-72 space-y-1">
            <label htmlFor="email" className="text-sm">
              邮箱关键字
            </label>
            <Input id="email" placeholder="例如 owner@agenticx.local" />
          </div>
          <div className="w-56 space-y-1">
            <label htmlFor="dept" className="text-sm">
              部门
            </label>
            <Input id="dept" placeholder="例如 运营中心" />
          </div>
          <Button>查询</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>用户列表</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
                  <th className="py-2 pr-4">用户 ID</th>
                  <th className="py-2 pr-4">邮箱</th>
                  <th className="py-2 pr-4">姓名</th>
                  <th className="py-2 pr-4">部门</th>
                  <th className="py-2 pr-4">状态</th>
                </tr>
              </thead>
              <tbody>
                {mockUsers.map((user) => (
                  <tr key={user.id} className="border-b border-zinc-100 dark:border-zinc-900">
                    <td className="py-2 pr-4">{user.id}</td>
                    <td className="py-2 pr-4">{user.email}</td>
                    <td className="py-2 pr-4">{user.displayName}</td>
                    <td className="py-2 pr-4">{user.dept}</td>
                    <td className="py-2 pr-4">{user.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

