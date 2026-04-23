"use client";

import type { AuthContext } from "@agenticx/auth";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@agenticx/ui";
import { BulkImportService, IamBulkImportApi, IamUserService, type ImportJob } from "@agenticx/feature-iam";
import { useMemo, useState } from "react";

const auth: AuthContext = {
  userId: "user_super_admin",
  tenantId: "tenant_default",
  email: "owner@agenticx.local",
  scopes: ["user:create", "user:read", "user:update", "user:delete", "role:read", "role:update"],
  sessionId: "session_admin_console",
};

export default function BulkImportPage() {
  const api = useMemo(() => {
    const userService = new IamUserService();
    const bulkService = new BulkImportService(userService);
    return new IamBulkImportApi(bulkService);
  }, []);

  const [csv, setCsv] = useState(
    "email,display_name,dept_id,password_hash\nalice@agenticx.local,Alice,dept-ops,$2b$12$ABCDEFGHIJKLMNOPQRSTUVWX1234567890\nbob@agenticx.local,Bob,dept-audit,$2b$12$ABCDEFGHIJKLMNOPQRSTUVWX1234567890"
  );
  const [precheckResult, setPrecheckResult] = useState<string>("尚未预检");
  const [job, setJob] = useState<ImportJob | null>(null);
  const [activeStep, setActiveStep] = useState<"upload" | "precheck" | "submit">("upload");

  const handlePrecheck = () => {
    const result = api.precheck(auth, csv);
    if ((result.data?.failures.length ?? 0) === 0) {
      setPrecheckResult("预检通过");
      setActiveStep("precheck");
      return;
    }
    setPrecheckResult(result.data?.failures.map((item) => `第 ${item.rowIndex} 行：${item.reason}`).join("；") ?? "预检失败");
    setActiveStep("precheck");
  };

  const handleSubmit = async () => {
    const result = await api.submit(auth, csv);
    setJob(result.data ?? null);
    setActiveStep("submit");
  };

  const handleRetry = async () => {
    if (!job) return;
    const result = await api.retry(auth, job.id);
    setJob(result.data ?? null);
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">批量开通子账号</h2>
        <p className="text-sm text-zinc-400">Upload → Precheck → Submit + Progress</p>
      </div>

      <Card className="border-zinc-800 bg-[var(--machi-bg-elevated)]">
        <CardHeader>
          <CardTitle>导入向导</CardTitle>
          <CardDescription>表头固定：email, display_name, dept_id, password_hash。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={activeStep} onValueChange={(value) => setActiveStep(value as typeof activeStep)}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="upload">1. Upload</TabsTrigger>
              <TabsTrigger value="precheck">2. Precheck</TabsTrigger>
              <TabsTrigger value="submit">3. Submit</TabsTrigger>
            </TabsList>
            <TabsContent value="upload" className="space-y-3 pt-3">
              <Textarea value={csv} onChange={(event) => setCsv(event.target.value)} rows={10} className="font-mono text-xs" />
              <Button type="button" variant="outline" onClick={handlePrecheck}>
                进入预检
              </Button>
            </TabsContent>
            <TabsContent value="precheck" className="space-y-3 pt-3">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-sm">{precheckResult}</div>
              <div className="flex gap-2">
                <Button type="button" onClick={handleSubmit}>
                  提交批处理
                </Button>
                <Button type="button" variant="secondary" onClick={() => setActiveStep("upload")}>
                  返回修改
                </Button>
              </div>
            </TabsContent>
            <TabsContent value="submit" className="space-y-3 pt-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">任务 ID: {job?.id ?? "-"}</Badge>
                <Badge variant={job?.status === "completed" ? "success" : "warning"}>状态: {job?.status ?? "-"}</Badge>
              </div>
              <Button type="button" variant="secondary" onClick={handleRetry} disabled={!job}>
                重试失败行
              </Button>
            </TabsContent>
          </Tabs>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={handlePrecheck}>
              预检
            </Button>
            <Button type="button" onClick={handleSubmit}>
              提交批处理
            </Button>
            <Button type="button" variant="secondary" onClick={handleRetry} disabled={!job}>
              重试失败行
            </Button>
          </div>
          <div className="text-sm text-zinc-400">预检结果：{precheckResult}</div>
        </CardContent>
      </Card>

      <Card className="border-zinc-800 bg-[var(--machi-bg-elevated)]">
        <CardHeader>
          <CardTitle>批处理进度</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>任务 ID：{job?.id ?? "-"}</div>
          <div>状态：{job?.status ?? "-"}</div>
          <div>总数：{job?.total ?? 0}</div>
          <div>成功：{job?.success ?? 0}</div>
          <div>失败：{job?.failed ?? 0}</div>
          <div className="sm:col-span-2 lg:col-span-3">失败明细：{job?.failures.map((item) => `${item.rowIndex}:${item.reason}`).join("；") || "-"}</div>
        </CardContent>
      </Card>
    </div>
  );
}

