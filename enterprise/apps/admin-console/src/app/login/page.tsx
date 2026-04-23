import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from "@agenticx/ui";
import { redirect } from "next/navigation";

async function signIn() {
  "use server";
  redirect("/iam/users");
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>管理员登录</CardTitle>
          <CardDescription>W2 占位登录页：W2-T10 将替换为真实 auth 服务。</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={signIn} className="space-y-4">
            <div className="space-y-1">
              <label htmlFor="email" className="text-sm font-medium">
                邮箱
              </label>
              <Input id="email" type="email" name="email" placeholder="admin@agenticx.local" required />
            </div>
            <div className="space-y-1">
              <label htmlFor="password" className="text-sm font-medium">
                密码
              </label>
              <Input id="password" type="password" name="password" placeholder="••••••••" required />
            </div>
            <Button className="w-full" type="submit">
              登录并进入控制台
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

