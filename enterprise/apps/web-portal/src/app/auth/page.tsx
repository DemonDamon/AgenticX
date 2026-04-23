"use client";

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from "@agenticx/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function AuthPage() {
  const router = useRouter();
  const [adminEmail, setAdminEmail] = useState("owner@agenticx.local");
  const [adminPassword, setAdminPassword] = useState("");
  const [provisionEmail, setProvisionEmail] = useState("staff@agenticx.local");
  const [provisionName, setProvisionName] = useState("Portal 员工");
  const [provisionPassword, setProvisionPassword] = useState("");
  const [loginEmail, setLoginEmail] = useState("staff@agenticx.local");
  const [loginPassword, setLoginPassword] = useState("");
  const [status, setStatus] = useState("先执行“管理员登录”，再执行“Admin 开号”，最后执行“Portal 登录”。");

  const loginAsAdmin = async () => {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: adminEmail,
        password: adminPassword,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      setStatus(`管理员登录失败：${data.message ?? "unknown error"}`);
      return;
    }
    setStatus("管理员登录成功，请执行 Admin 开号。");
  };

  const provision = async () => {
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tenantId: "01J00000000000000000000001",
        deptId: "01J00000000000000000000003",
        email: provisionEmail,
        displayName: provisionName,
        password: provisionPassword,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      setStatus(`开号失败：${data.message ?? "unknown error"}`);
      return;
    }
    setStatus("Admin 开号成功，请继续执行 Portal 登录。");
    setLoginEmail(provisionEmail);
    setLoginPassword(provisionPassword);
  };

  const login = async () => {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: loginEmail,
        password: loginPassword,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      setStatus(`登录失败：${data.message ?? "unknown error"}`);
      return;
    }
    setStatus("登录成功，正在跳转 workspace ...");
    router.push("/workspace");
  };

  return (
    <main className="mx-auto grid max-w-6xl gap-4 p-8 md:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle>Step 0 · 管理员登录</CardTitle>
          <CardDescription>使用 Owner 账号登录以获取开账号权限（需配置 AUTH_DEV_OWNER_PASSWORD）。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <label className="text-sm" htmlFor="admin-email">
              管理员邮箱
            </label>
            <Input id="admin-email" value={adminEmail} onChange={(event) => setAdminEmail(event.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-sm" htmlFor="admin-password">
              管理员密码
            </label>
            <Input
              id="admin-password"
              type="password"
              value={adminPassword}
              onChange={(event) => setAdminPassword(event.target.value)}
            />
          </div>
          <Button type="button" onClick={loginAsAdmin}>
            管理员登录
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Step 1 · Admin 开号</CardTitle>
          <CardDescription>基于当前管理员会话创建账号，写入共享用户仓库。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <label className="text-sm" htmlFor="provision-email">
              邮箱
            </label>
            <Input
              id="provision-email"
              value={provisionEmail}
              onChange={(event) => setProvisionEmail(event.target.value)}
              placeholder="staff@agenticx.local"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm" htmlFor="provision-name">
              显示名
            </label>
            <Input id="provision-name" value={provisionName} onChange={(event) => setProvisionName(event.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-sm" htmlFor="provision-password">
              初始密码
            </label>
            <Input
              id="provision-password"
              type="password"
              value={provisionPassword}
              onChange={(event) => setProvisionPassword(event.target.value)}
            />
          </div>
          <Button type="button" onClick={provision}>
            Admin 开号
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Step 2 · Portal 登录</CardTitle>
          <CardDescription>使用 `@agenticx/auth` 完成登录并下发 access/refresh cookie。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <label className="text-sm" htmlFor="login-email">
              邮箱
            </label>
            <Input id="login-email" value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-sm" htmlFor="login-password">
              密码
            </label>
            <Input
              id="login-password"
              type="password"
              value={loginPassword}
              onChange={(event) => setLoginPassword(event.target.value)}
            />
          </div>
          <Button type="button" onClick={login}>
            登录并进入 Workspace
          </Button>
        </CardContent>
      </Card>

      <Card className="md:col-span-3">
        <CardHeader>
          <CardTitle>链路状态</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-zinc-500">{status}</CardContent>
      </Card>
    </main>
  );
}

