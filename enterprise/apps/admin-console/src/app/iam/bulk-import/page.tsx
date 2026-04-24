"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { AuthContext } from "@agenticx/auth";
import {
  Alert,
  AlertDescription,
  AlertTitle,
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
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Progress,
  Separator,
  Textarea,
  toast,
} from "@agenticx/ui";
import { BulkImportService, IamBulkImportApi, IamUserService, type ImportJob } from "@agenticx/feature-iam";
import {
  Check,
  ChevronRight,
  CircleDot,
  FileSpreadsheet,
  ListChecks,
  RefreshCcw,
  RotateCcw,
  ShieldCheck,
  Upload,
} from "lucide-react";

const auth: AuthContext = {
  userId: "user_super_admin",
  tenantId: "tenant_default",
  email: "owner@agenticx.local",
  scopes: ["user:create", "user:read", "user:update", "user:delete", "role:read", "role:update"],
  sessionId: "session_admin_console",
};

type Step = 0 | 1 | 2;

const STEPS = [
  { id: 0, label: "上传 CSV", description: "输入或粘贴 CSV 内容", icon: Upload },
  { id: 1, label: "预检校验", description: "检查字段与格式合法性", icon: ShieldCheck },
  { id: 2, label: "执行导入", description: "批量创建并查看进度", icon: ListChecks },
] as const;

const CSV_TEMPLATE =
  "email,display_name,dept_id,password_hash\nalice@agenticx.local,Alice,dept-ops,$2b$12$ABCDEFGHIJKLMNOPQRSTUVWX1234567890\nbob@agenticx.local,Bob,dept-audit,$2b$12$ABCDEFGHIJKLMNOPQRSTUVWX1234567890";

export default function BulkImportPage() {
  const api = useMemo(() => {
    const userService = new IamUserService();
    const bulkService = new BulkImportService(userService);
    return new IamBulkImportApi(bulkService);
  }, []);

  const [step, setStep] = useState<Step>(0);
  const [csv, setCsv] = useState(CSV_TEMPLATE);
  const [precheckFailures, setPrecheckFailures] = useState<Array<{ rowIndex: number; reason: string }>>([]);
  const [precheckTotal, setPrecheckTotal] = useState(0);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [busy, setBusy] = useState(false);

  const csvLines = useMemo(() => {
    const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
    return Math.max(0, lines.length - 1);
  }, [csv]);

  const handlePrecheck = () => {
    const result = api.precheck(auth, csv);
    const failures = result.data?.failures ?? [];
    setPrecheckFailures(failures);
    setPrecheckTotal(csvLines);
    setStep(1);
    if (failures.length === 0) {
      toast.success(`预检通过：${csvLines} 条记录`);
    } else {
      toast.error(`发现 ${failures.length} 条失败`);
    }
  };

  const handleSubmit = async () => {
    setBusy(true);
    try {
      const result = await api.submit(auth, csv);
      setJob(result.data ?? null);
      setStep(2);
      if (result.data?.status === "completed") {
        toast.success(`导入完成：成功 ${result.data.success} / 失败 ${result.data.failed}`);
      } else {
        toast.error(`导入未完成，请查看失败明细`);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRetry = async () => {
    if (!job) return;
    setBusy(true);
    try {
      const result = await api.retry(auth, job.id);
      setJob(result.data ?? null);
      toast.success("已重试失败行");
    } finally {
      setBusy(false);
    }
  };

  const handleReset = () => {
    setStep(0);
    setCsv(CSV_TEMPLATE);
    setPrecheckFailures([]);
    setPrecheckTotal(0);
    setJob(null);
  };

  const progress = job ? Math.min(100, Math.round(((job.success + job.failed) / Math.max(1, job.total)) * 100)) : 0;

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
                <BreadcrumbPage>批量导入</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        title="批量开通子账号"
        description="上传 CSV → 预检校验 → 提交导入，失败行可重试"
        actions={
          <Button variant="outline" size="sm" onClick={handleReset}>
            <RotateCcw />
            重新开始
          </Button>
        }
      />

      {/* Stepper 头 */}
      <Card>
        <CardContent className="p-5">
          <div className="flex flex-wrap items-center gap-3">
            {STEPS.map((item, index) => {
              const Icon = item.icon;
              const reached = step >= (item.id as number);
              const active = step === (item.id as number);
              return (
                <div key={item.id} className="flex items-center gap-2">
                  <div
                    className={[
                      "flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-semibold transition-colors",
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : reached
                        ? "border-success bg-success-soft text-success"
                        : "border-border bg-muted text-muted-foreground",
                    ].join(" ")}
                  >
                    {reached && !active ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0">
                    <div className={["text-sm font-medium", active ? "text-foreground" : "text-muted-foreground"].join(" ")}>
                      {item.label}
                    </div>
                    <div className="hidden text-xs text-muted-foreground sm:block">{item.description}</div>
                  </div>
                  {index < STEPS.length - 1 ? (
                    <ChevronRight className="mx-1 h-4 w-4 text-muted-foreground/50" />
                  ) : null}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Step 0: Upload */}
      {step === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>1. 上传 CSV</CardTitle>
            <CardDescription>表头必须为：email, display_name, dept_id, password_hash</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="soft" className="gap-1">
                <FileSpreadsheet className="h-3 w-3" />
                {csvLines} 条记录
              </Badge>
              <Button
                variant="outline"
                size="xs"
                onClick={() => {
                  setCsv(CSV_TEMPLATE);
                  toast.success("已恢复示例数据");
                }}
              >
                <RotateCcw />
                恢复示例
              </Button>
            </div>
            <Textarea
              value={csv}
              onChange={(event) => setCsv(event.target.value)}
              rows={12}
              className="font-mono text-xs"
              placeholder="email,display_name,dept_id,password_hash&#10;..."
            />
            <div className="flex items-center justify-end gap-2">
              <Button onClick={handlePrecheck} disabled={csvLines === 0}>
                <ShieldCheck />
                进入预检
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Step 1: Precheck */}
      {step === 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>2. 预检校验结果</CardTitle>
            <CardDescription>
              总记录 {precheckTotal} 条 · 失败 {precheckFailures.length} 条
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {precheckFailures.length === 0 ? (
              <Alert variant="success">
                <ShieldCheck className="h-5 w-5" />
                <AlertTitle>校验通过</AlertTitle>
                <AlertDescription>所有 {precheckTotal} 条记录格式合法，可安全提交。</AlertDescription>
              </Alert>
            ) : (
              <Alert variant="warning">
                <CircleDot className="h-5 w-5" />
                <AlertTitle>发现 {precheckFailures.length} 条失败</AlertTitle>
                <AlertDescription>
                  修正后再次预检；提交时仅成功行会被写入，失败行会保留在任务报告里。
                </AlertDescription>
              </Alert>
            )}

            {precheckFailures.length > 0 ? (
              <div className="max-h-[320px] overflow-y-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/60 backdrop-blur">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        行
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        原因
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {precheckFailures.map((failure, index) => (
                      <tr key={`${failure.rowIndex}-${index}`} className="border-t border-border">
                        <td className="px-3 py-2 font-mono text-xs">#{failure.rowIndex}</td>
                        <td className="px-3 py-2 text-danger">{failure.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            <div className="flex items-center justify-between gap-2">
              <Button variant="outline" onClick={() => setStep(0)}>
                <RotateCcw />
                返回修改
              </Button>
              <Button onClick={handleSubmit} disabled={busy}>
                <ListChecks />
                {busy ? "提交中..." : "提交批处理"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Step 2: Submit + Progress */}
      {step === 2 ? (
        <Card>
          <CardHeader>
            <CardTitle>3. 执行结果</CardTitle>
            <CardDescription>
              任务 ID：<span className="font-mono text-xs text-foreground">{job?.id ?? "-"}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {job ? (
              <>
                <div className="grid gap-3 sm:grid-cols-4">
                  <StatMini label="总数" value={job.total} variant="default" />
                  <StatMini label="成功" value={job.success} variant="success" />
                  <StatMini label="失败" value={job.failed} variant="danger" />
                  <StatMini
                    label="状态"
                    value={job.status}
                    variant={job.status === "completed" ? "success" : job.status === "failed" ? "danger" : "warning"}
                  />
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>进度</span>
                    <span className="font-mono">{progress}%</span>
                  </div>
                  <Progress
                    value={progress}
                    indicatorClassName={job.status === "failed" ? "bg-danger" : undefined}
                  />
                </div>

                {job.failures.length > 0 ? (
                  <div className="rounded-lg border border-danger/30 bg-danger-soft/40 p-3">
                    <div className="mb-2 text-sm font-semibold text-danger">失败明细</div>
                    <ul className="space-y-1 text-xs text-danger">
                      {job.failures.slice(0, 10).map((failure, index) => (
                        <li key={`${failure.rowIndex}-${index}`} className="font-mono">
                          #{failure.rowIndex}: {failure.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <Separator />

                <div className="flex items-center justify-between gap-2">
                  <Button variant="outline" onClick={handleReset}>
                    <RotateCcw />
                    导入另一批
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void handleRetry()}
                    disabled={!job || job.failed === 0 || busy}
                  >
                    <RefreshCcw />
                    重试失败行 ({job.failed})
                  </Button>
                </div>
              </>
            ) : (
              <EmptyState
                icon={<ListChecks className="h-5 w-5" />}
                title="正在提交..."
                description="稍候片刻"
                size="sm"
                className="border-0"
              />
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function StatMini({
  label,
  value,
  variant = "default",
}: {
  label: string;
  value: number | string;
  variant?: "default" | "success" | "warning" | "danger";
}) {
  const variantClass =
    variant === "success"
      ? "bg-success-soft text-success"
      : variant === "warning"
      ? "bg-warning-soft text-warning-foreground"
      : variant === "danger"
      ? "bg-danger-soft text-danger"
      : "bg-muted text-foreground";
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={["mt-1.5 inline-flex rounded-md px-2 py-0.5 font-mono text-lg font-semibold", variantClass].join(" ")}>
        {value}
      </div>
    </div>
  );
}
