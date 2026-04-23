import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@agenticx/ui";
import { SYSTEM_ROLE_TEMPLATES } from "@agenticx/feature-iam";

export default function RolesPage() {
  const entries = Object.entries(SYSTEM_ROLE_TEMPLATES);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">角色与权限</h2>
        <p className="text-sm text-zinc-400">角色列表 + 权限矩阵</p>
      </div>
      <Card className="border-zinc-800 bg-[var(--machi-bg-elevated)]">
        <CardHeader>
          <CardTitle>系统角色矩阵</CardTitle>
          <CardDescription>后续会接入角色增删改与用户绑定 API</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>角色</TableHead>
                <TableHead>描述</TableHead>
                <TableHead>Scopes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map(([code, role]) => (
                <TableRow key={code}>
                  <TableCell className="font-medium">
                    {code} · {role.name}
                  </TableCell>
                  <TableCell>{`${role.scopes.length} scopes`}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      {role.scopes.map((scope) => (
                        <Badge key={scope} variant="outline">
                          {scope}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

