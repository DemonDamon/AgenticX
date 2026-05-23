"use client";
import { adminFetch } from "../../../lib/admin-client-auth";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import Papa from "papaparse";
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
  Label,
  PageHeader,
  Progress,
  Separator,
  Textarea,
  toast,
} from "@agenticx/ui";
import { useTranslations } from "next-intl";
import {
  Check,
  ChevronRight,
  CircleDot,
  Download,
  FileSpreadsheet,
  Link2,
  ListChecks,
  RotateCcw,
  ShieldCheck,
  Upload,
} from "lucide-react";

const LS_MAP_KEY = "agx-iam-bulk-import-column-map-v1";

type FieldKey =
  | "email"
  | "display_name"
  | "dept_path"
  | "role_codes"
  | "phone"
  | "employee_no"
  | "job_title"
  | "status"
  | "initial_password";

type Step = 0 | 1 | 2 | 3 | 4;

type ParsedRow = Record<string, string>;

type PrecheckFailure = { rowIndex: number; reason: string };

type ApiBulkResp = {
  code: string;
  message: string;
  data?: {
    success: number;
    failed: number;
    failures: Array<{
      index: number;
      email: string;
      reason: string;
      displayName?: string;
      deptPath?: string;
      roleCodes?: string;
      phone?: string;
      employeeNo?: string;
      jobTitle?: string;
      status?: string;
    }>;
  };
};

function loadSavedMap(): Partial<Record<FieldKey, string>> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(LS_MAP_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<Record<FieldKey, string>>;
  } catch {
    return {};
  }
}

function normalizeStatus(v: string | undefined): "active" | "disabled" | undefined {
  const s = (v ?? "").trim().toLowerCase();
  if (!s) return undefined;
  if (s === "disabled" || s === "0" || s === "false" || s === "停用") return "disabled";
  return "active";
}

function parseRoleCodes(v: string | undefined): string[] {
  const s = (v ?? "").trim();
  if (!s) return [];
  return s
    .split(/[;，,|]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export default function BulkImportPage() {
  const t = useTranslations("pages.iam.bulkImport");
  const tc = useTranslations("common");
  const ts = useTranslations("shell");
  const fieldDefs = useMemo(
    () =>
      [
        { key: "email" as const, label: t("fields.email"), required: true },
        { key: "display_name" as const, label: t("fields.displayName"), required: true },
        { key: "dept_path" as const, label: t("fields.deptPath"), required: false },
        { key: "role_codes" as const, label: t("fields.roleCodes"), required: false },
        { key: "phone" as const, label: t("fields.phone"), required: false },
        { key: "employee_no" as const, label: t("fields.employeeNo"), required: false },
        { key: "job_title" as const, label: t("fields.jobTitle"), required: false },
        { key: "status" as const, label: t("fields.status"), required: false },
        { key: "initial_password" as const, label: t("fields.initialPassword"), required: false },
      ] as const,
    [t]
  );
  const steps = useMemo(
    () => [
      { id: 0 as Step, label: t("steps.upload.label"), description: t("steps.upload.description"), icon: Upload },
      { id: 1 as Step, label: t("steps.mapping.label"), description: t("steps.mapping.description"), icon: Link2 },
      { id: 2 as Step, label: t("steps.precheck.label"), description: t("steps.precheck.description"), icon: ShieldCheck },
      { id: 3 as Step, label: t("steps.execute.label"), description: t("steps.execute.description"), icon: ListChecks },
      { id: 4 as Step, label: t("steps.done.label"), description: t("steps.done.description"), icon: Check },
    ],
    [t]
  );
  const [step, setStep] = useState<Step>(0);
  const [csvText, setCsvText] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [columnMap, setColumnMap] = useState<Partial<Record<FieldKey, string>>>(() => loadSavedMap());
  const [precheckFailures, setPrecheckFailures] = useState<PrecheckFailure[]>([]);
  const [busy, setBusy] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [result, setResult] = useState<ApiBulkResp["data"] | null>(null);

  const parseCsv = useCallback((text: string) => {
    const out = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h: string) => h.trim(),
    });
    if (out.errors?.length) {
      toast.error(out.errors[0]?.message ?? t("csvParseFailed"));
    }
    const fields = (out.meta.fields ?? []).filter((x): x is string => Boolean(x));
    setHeaders(fields);
    setRows(
      (out.data ?? []).filter((r) => Object.values(r).some((c) => String(c).trim()))
    );
  }, []);

  const mappedRows = useMemo(() => {
    const emailCol = columnMap.email;
    const nameCol = columnMap.display_name;
    if (!emailCol || !nameCol) return [];
    return rows.map((r) => {
      const email = String(r[emailCol] ?? "").trim();
      const displayName = String(r[nameCol] ?? "").trim();
      const deptPath = columnMap.dept_path ? String(r[columnMap.dept_path] ?? "").trim() : "";
      const roleRaw = columnMap.role_codes ? String(r[columnMap.role_codes] ?? "").trim() : "";
      const phone = columnMap.phone ? String(r[columnMap.phone] ?? "").trim() : "";
      const employeeNo = columnMap.employee_no ? String(r[columnMap.employee_no] ?? "").trim() : "";
      const jobTitle = columnMap.job_title ? String(r[columnMap.job_title] ?? "").trim() : "";
      const statusRaw = columnMap.status ? String(r[columnMap.status] ?? "").trim() : "";
      const initialPassword = columnMap.initial_password ? String(r[columnMap.initial_password] ?? "").trim() : "";
      return {
        email,
        displayName,
        deptPath,
        roleCodes: parseRoleCodes(roleRaw),
        phone: phone || null,
        employeeNo: employeeNo || null,
        jobTitle: jobTitle || null,
        status: normalizeStatus(statusRaw),
        initialPassword: initialPassword || null,
      };
    });
  }, [rows, columnMap]);

  const runPrecheck = useCallback(() => {
    const fails: PrecheckFailure[] = [];
    mappedRows.forEach((mr, i) => {
      const rowIndex = i + 2;
      if (!mr.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mr.email)) {
        fails.push({ rowIndex, reason: t("precheck.invalidEmail") });
        return;
      }
      if (!mr.displayName) {
        fails.push({ rowIndex, reason: t("precheck.nameRequired") });
      }
    });
    setPrecheckFailures(fails);
    setStep(2);
    if (fails.length === 0) toast.success(t("precheck.passToast", { count: mappedRows.length }));
    else toast.error(t("precheck.failToast", { count: fails.length }));
  }, [mappedRows]);

  const persistMap = () => {
    try {
      localStorage.setItem(LS_MAP_KEY, JSON.stringify(columnMap));
      toast.success(t("mapping.savedLocal"));
    } catch {
      toast.error(t("mapping.localStorageFailed"));
    }
  };

  const buildApiRows = () =>
    mappedRows.map((mr) => ({
      email: mr.email.toLowerCase(),
      displayName: mr.displayName,
      deptPath: mr.deptPath || undefined,
      roleCodes: mr.roleCodes.length ? mr.roleCodes : undefined,
      phone: mr.phone,
      employeeNo: mr.employeeNo,
      jobTitle: mr.jobTitle,
      status: mr.status,
      initialPassword: mr.initialPassword,
    }));

  const handleExecute = async () => {
    if (mappedRows.length > 5000) {
      toast.error(t("execute.maxRows"));
      return;
    }
    setBusy(true);
    setProgressPct(10);
    try {
      const res = await adminFetch("/api/admin/iam/bulk-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: buildApiRows() }),
      });
      setProgressPct(90);
      const json = (await res.json()) as ApiBulkResp;
      setResult(json.data ?? null);
      setStep(4);
      if (json.data && json.data.failed === 0) toast.success(t("execute.completeSuccess", { count: json.data.success }));
      else toast.error(json.message ?? t("execute.partialFailed"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("execute.requestFailed"));
    } finally {
      setProgressPct(100);
      setBusy(false);
    }
  };

  const downloadFailures = () => {
    if (!result?.failures?.length) return;
    const head = [
      "index",
      "email",
      "reason",
      "displayName",
      "deptPath",
      "roleCodes",
      "phone",
      "employeeNo",
      "jobTitle",
      "status",
    ];
    const lines = [
      head.join(","),
      ...result.failures.map((f) =>
        [
          f.index,
          f.email,
          f.reason,
          f.displayName ?? "",
          f.deptPath ?? "",
          f.roleCodes ?? "",
          f.phone ?? "",
          f.employeeNo ?? "",
          f.jobTitle ?? "",
          f.status ?? "",
        ]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(",")
      ),
    ];
    const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `iam-import-failures-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const resetAll = () => {
    setStep(0);
    setCsvText("");
    setHeaders([]);
    setRows([]);
    setPrecheckFailures([]);
    setProgressPct(0);
    setResult(null);
  };

  const mapReady = Boolean(columnMap.email && columnMap.display_name);

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
              <BreadcrumbItem>{t("breadcrumbIam")}</BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{t("breadcrumbBulkImport")}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        title={t("title")}
        description={t("description")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href="/templates/iam-bulk-import-example.csv" download>
                <Download className="mr-1 h-4 w-4" />
                {t("templateDownload")}
              </a>
            </Button>
            <Button variant="outline" size="sm" onClick={resetAll}>
              <RotateCcw className="mr-1 h-4 w-4" />
              {t("restart")}
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="p-5">
          <div className="flex flex-wrap items-center gap-3">
            {steps.map((item, index) => {
              const Icon = item.icon;
              const reached = step >= item.id;
              const active = step === item.id;
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
                  {index < steps.length - 1 ? <ChevronRight className="mx-1 h-4 w-4 text-muted-foreground/50" /> : null}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {step === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("upload.title")}</CardTitle>
            <CardDescription>{t("upload.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="soft" className="gap-1">
                <FileSpreadsheet className="h-3 w-3" />
                {t("upload.rowCount", { count: rows.length })}
              </Badge>
              <input
                type="file"
                accept=".csv,text/csv"
                className="text-xs text-muted-foreground"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  void f.text().then((text) => {
                    setCsvText(text);
                    parseCsv(text);
                    setStep(1);
                    toast.success(t("upload.parseSuccess"));
                  });
                }}
              />
            </div>
            <Textarea
              value={csvText}
              onChange={(event) => setCsvText(event.target.value)}
              rows={12}
              className="font-mono text-xs"
              placeholder="email,display_name,dept_path,role_codes&#10;..."
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setCsvText("");
                  setHeaders([]);
                  setRows([]);
                }}
              >
                {t("upload.clear")}
              </Button>
              <Button
                onClick={() => {
                  if (!csvText.trim()) {
                    toast.error(t("upload.needContent"));
                    return;
                  }
                  parseCsv(csvText);
                  setStep(1);
                }}
              >
                {t("upload.nextMapping")}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("mapping.title")}</CardTitle>
            <CardDescription>{t("mapping.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {headers.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("mapping.noHeaders")}</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {fieldDefs.map((def) => (
                  <div key={def.key} className="space-y-1">
                    <Label className="text-xs">
                      {def.label}
                      {def.required ? " *" : ""}
                    </Label>
                    <select
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                      value={columnMap[def.key] ?? ""}
                      onChange={(e) =>
                        setColumnMap((prev) => ({
                          ...prev,
                          [def.key]: e.target.value || undefined,
                        }))
                      }
                    >
                      <option value="">{t("mapping.notMapped")}</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-wrap justify-between gap-2">
              <Button variant="outline" onClick={persistMap}>
                {t("mapping.saveLocal")}
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep(0)}>
                  {t("mapping.prev")}
                </Button>
                <Button disabled={!mapReady} onClick={runPrecheck}>
                  {t("mapping.precheck")}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 2 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("precheck.title")}</CardTitle>
            <CardDescription>
              {t("precheck.summary", { total: mappedRows.length, failed: precheckFailures.length })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {precheckFailures.length === 0 ? (
              <Alert variant="success">
                <ShieldCheck className="h-5 w-5" />
                <AlertTitle>{t("precheck.passedTitle")}</AlertTitle>
                <AlertDescription>{t("precheck.passedDescription")}</AlertDescription>
              </Alert>
            ) : (
              <Alert variant="warning">
                <CircleDot className="h-5 w-5" />
<AlertTitle>{t("precheck.failedTitle", { count: precheckFailures.length })}</AlertTitle>
                <AlertDescription>{t("precheck.failedDescription")}</AlertDescription>
              </Alert>
            )}
            {precheckFailures.length > 0 ? (
              <div className="max-h-[240px] overflow-y-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/60">
                    <tr>
<th className="px-3 py-2 text-left text-xs uppercase text-muted-foreground">{t("precheck.rowHeader")}</th>
                      <th className="px-3 py-2 text-left text-xs uppercase text-muted-foreground">{t("precheck.reasonHeader")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {precheckFailures.map((f, i) => (
                      <tr key={`${f.rowIndex}-${i}`} className="border-t border-border">
                        <td className="px-3 py-2 font-mono text-xs">#{f.rowIndex}</td>
                        <td className="px-3 py-2 text-danger">{f.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <div className="flex justify-between gap-2">
              <Button variant="outline" onClick={() => setStep(1)}>
                {t("precheck.backMapping")}
              </Button>
              <Button disabled={precheckFailures.length > 0 || busy} onClick={() => setStep(3)}>
                {t("precheck.startImport")}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 3 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("execute.title")}</CardTitle>
<CardDescription>{t("execute.description", { count: mappedRows.length })}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Progress value={progressPct} />
            <div className="flex justify-between gap-2">
              <Button variant="outline" onClick={() => setStep(2)}>
                {t("execute.back")}
              </Button>
              <Button disabled={busy} onClick={() => void handleExecute()}>
                {busy ? t("execute.running") : t("execute.confirm")}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 4 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("result.title")}</CardTitle>
<CardDescription>{t("result.summary", { success: result?.success ?? 0, failed: result?.failed ?? 0 })}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {result ? (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <StatMini label={t("result.success")} value={result.success} variant="success" />
                  <StatMini label={t("result.failed")} value={result.failed} variant="danger" />
                  <StatMini label={t("result.total")} value={result.success + result.failed} variant="default" />
                </div>
                {result.failures.length > 0 ? (
                  <div className="rounded-lg border border-danger/30 bg-danger-soft/40 p-3">
                    <div className="mb-2 text-sm font-semibold text-danger">{t("result.serverFailures")}</div>
                    <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-danger">
                      {result.failures.map((f, i) => (
                        <li key={`${f.index}-${i}`} className="font-mono">
                          #{f.index} {f.email}: {f.reason}
                        </li>
                      ))}
                    </ul>
                    <Button variant="outline" size="sm" className="mt-2" onClick={downloadFailures}>
                      {t("result.downloadFailures")}
                    </Button>
                  </div>
                ) : null}
                <Separator />
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" asChild>
                    <Link href="/iam/users">{t("result.goUsers")}</Link>
                  </Button>
                  <Button onClick={resetAll}>{t("result.nextBatch")}</Button>
                </div>
              </>
            ) : (
              <EmptyState title={t("result.noResult")} description={t("result.noResultDescription")} size="sm" className="border-0" />
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
  variant?: "default" | "success" | "danger";
}) {
  const cls =
    variant === "success"
      ? "bg-success-soft text-success"
      : variant === "danger"
        ? "bg-danger-soft text-danger"
        : "bg-muted text-foreground";
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={["mt-1.5 inline-flex rounded-md px-2 py-0.5 font-mono text-lg font-semibold", cls].join(" ")}>
        {value}
      </div>
    </div>
  );
}
