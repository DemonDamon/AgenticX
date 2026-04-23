import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@agenticx/ui";
import { SYSTEM_ROLE_TEMPLATES } from "@agenticx/feature-iam";

export default function RolesPage() {
  const entries = Object.entries(SYSTEM_ROLE_TEMPLATES);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">角色与权限</h2>
        <p className="text-sm text-zinc-500">系统角色（owner/admin/member/auditor）与 `resource:action` scope 语法已挂载。</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>系统角色矩阵</CardTitle>
          <CardDescription>后续会接入角色增删改与用户绑定 API。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {entries.map(([code, role]) => (
            <div key={code} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="mb-2 text-sm font-semibold">
                {code} · {role.name}
              </div>
              <div className="flex flex-wrap gap-2">
                {role.scopes.map((scope) => (
                  <span
                    key={scope}
                    className="rounded bg-zinc-100 px-2 py-1 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                  >
                    {scope}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

