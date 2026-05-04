"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { AuditEvent } from "@agenticx/core-api";
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
  DataTable,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Separator,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from "@agenticx/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { FileWarning, Filter, Inbox, RefreshCcw, Search, ShieldAlert, ShieldCheck, SlidersHorizontal } from "lucide-react";

type QueryResult = {
  total: number;
  items: AuditEvent[];
  chain_valid: boolean;
  chain_error_at?: string;
  chain_error_reason?: string;
};

export default function AuditPage() {
  const [items, setItems] = useState<AuditEvent[]>([]);
  const [selected, setSelected] = useState<AuditEvent | null>(null);
  const [chainValid, setChainValid] = useState(true);
  const [chainError, setChainError] = useState<{ at?: string; reason?: string } | null>(null);
  const [userId, setUserId] = useState("");
  const [model, setModel] = useState("");
  const [policyHit, setPolicyHit] = useState("");
  const [loading, setLoading] = useState(false);

  const [chainFull, setChainFull] = useState<{
    valid: boolean;
    at?: string;
    reason?: string;
    scanned?: number;
  } | null>(null);

  const loadChainVerify = useCallback(async () => {
    try {
      const response = await fetch("/api/audit/chain-verify");
      const payload = (await response.json()) as {
        data?: { valid: boolean; at?: string; reason?: string; scanned: number };
      };
      setChainFull(payload.data ?? null);
    } catch {
      setChainFull(null);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/audit/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          user_id: userId || undefined,
          model: model || undefined,
          policy_hit: policyHit || undefined,
        }),
      });
      const payload = (await response.json()) as { code?: string; data?: QueryResult; message?: string };
      const data = payload.data;
      setItems(data?.items ?? []);
      setChainValid(data?.chain_valid ?? true);
      setChainError(
        data?.chain_valid
          ? null
          : {
              at: data?.chain_error_at,
              reason: data?.chain_error_reason,
            }
      );
      await loadChainVerify();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [userId, model, policyHit, loadChainVerify]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleExport = async () => {
    const response = await fetch("/api/audit/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        user_id: userId || undefined,
        model: model || undefined,
        policy_hit: policyHit || undefined,
      }),
    });
    const csv = await response.text();
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `audit-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success(`已导出 ${items.length} 条记录`);
  };

  const columns = useMemo<ColumnDef<AuditEvent>[]>(
    () => [
      {
        accessorKey: "event_time",
        header: "时间",
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">{row.original.event_time}</span>
        ),
      },
      {
        accessorKey: "event_type",
        header: "事件",
        cell: ({ row }) => <span className="font-medium">{row.original.event_type}</span>,
      },
      {
        accessorKey: "user_id",
        header: "用户",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[10px] font-semibold text-primary">
              {row.original.user_id?.slice(0, 1)?.toUpperCase() ?? "?"}
            </span>
            <span className="truncate text-sm">{row.original.user_id ?? "—"}</span>
          </div>
        ),
      },
      {
        accessorKey: "model",
        header: "模型",
        cell: ({ row }) =>
          row.original.model ? (
            <Badge variant="soft" className="font-mono text-[10px]">
              {row.original.model}
            </Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: "policies_hit",
        header: "策略命中",
        cell: ({ row }) => {
          const count = row.original.policies_hit?.length ?? 0;
          if (count === 0) {
            return (
              <Badge variant="success" className="gap-1">
                <ShieldCheck className="h-3 w-3" />
                合规
              </Badge>
            );
          }
          return (
            <Badge variant="destructive" className="gap-1">
              <ShieldAlert className="h-3 w-3" />
              命中 {count}
            </Badge>
          );
        },
      },
    ],
    []
  );

  const activeFilters = useMemo(() => {
    const list = [];
    if (userId) list.push({ id: "user", label: `用户：${userId}`, onRemove: () => setUserId("") });
    if (model) list.push({ id: "model", label: `模型：${model}`, onRemove: () => setModel("") });
    if (policyHit) list.push({ id: "policy", label: `策略：${policyHit}`, onRemove: () => setPolicyHit("") });
    return list;
  }, [userId, model, policyHit]);

  const headerChainOk = chainFull != null ? chainFull.valid : chainValid;
  const headerChainAt =
    chainFull != null && !chainFull.valid ? chainFull.at : chainFull == null && !chainValid ? chainError?.at : undefined;

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
              <BreadcrumbItem>
                <BreadcrumbPage>审计日志</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        title="审计日志"
        description={`共 ${items.length} 条记录 · ${
          chainFull != null
            ? `${chainFull.valid ? "全表链校验通过" : `全表链校验失败${chainFull.reason ? `（${chainFull.reason}）` : ""}`} · 已扫 ${chainFull.scanned} 行`
            : chainValid
              ? "全表链校验加载中…"
              : `当前页链校验失败${chainError?.reason ? `（${chainError.reason}）` : ""}`
        }`}
        actions={
          <>
            <Badge variant={headerChainOk ? "success" : "destructive"} className="gap-1">
              <ShieldCheck className="h-3 w-3" />
              {headerChainOk ? "链完整" : "链异常"}
            </Badge>
            {!headerChainOk && headerChainAt ? (
              <Badge variant="warning" className="font-mono text-[10px]">
                {headerChainAt}
              </Badge>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCcw />
              刷新
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="pt-5">
          <DataTable
            columns={columns}
            data={items}
            searchPlaceholder="按事件类型 / 用户 / 模型搜索..."
            activeFilters={activeFilters}
            onClearFilters={() => {
              setUserId("");
              setModel("");
              setPolicyHit("");
            }}
            onRowClick={(row) => setSelected(row.original)}
            onExport={handleExport}
            emptyState={
              <EmptyState
                icon={<FileWarning className="h-5 w-5" />}
                title={loading ? "加载中..." : "暂无审计事件"}
                description={loading ? "正在查询网关审计流" : "无符合条件的记录"}
                size="sm"
                className="border-0"
              />
            }
            toolbarLeft={
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <Filter />
                    高级筛选
                    {activeFilters.length > 0 ? (
                      <Badge variant="default" className="ml-1 h-4 min-w-4 px-1 text-[10px]">
                        {activeFilters.length}
                      </Badge>
                    ) : null}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-80">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <SlidersHorizontal className="h-4 w-4" />
                      高级筛选
                    </div>
                    <Separator />
                    <div className="space-y-1.5">
                      <Label htmlFor="flt-user">用户 ID</Label>
                      <Input
                        id="flt-user"
                        value={userId}
                        onChange={(event) => setUserId(event.target.value)}
                        placeholder="user_demo"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="flt-model">模型</Label>
                      <Input
                        id="flt-model"
                        value={model}
                        onChange={(event) => setModel(event.target.value)}
                        placeholder="deepseek-chat"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="flt-policy">策略命中</Label>
                      <Input
                        id="flt-policy"
                        value={policyHit}
                        onChange={(event) => setPolicyHit(event.target.value)}
                        placeholder="finance-keyword-insider"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setUserId("");
                          setModel("");
                          setPolicyHit("");
                        }}
                      >
                        清空
                      </Button>
                      <Button size="sm" onClick={() => void load()}>
                        <Search />
                        应用筛选
                      </Button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            }
            getRowId={(row) => row.id}
          />
        </CardContent>
      </Card>

      {/* 详情抽屉 */}
      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-2xl">
          {selected ? (
            <div className="flex h-full flex-col gap-4">
              <SheetHeader>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={(selected.policies_hit?.length ?? 0) > 0 ? "destructive" : "success"}
                    className="gap-1"
                  >
                    {(selected.policies_hit?.length ?? 0) > 0 ? (
                      <>
                        <ShieldAlert className="h-3 w-3" />
                        命中 {selected.policies_hit?.length ?? 0}
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="h-3 w-3" />
                        合规
                      </>
                    )}
                  </Badge>
                  <SheetTitle>{selected.event_type}</SheetTitle>
                </div>
                <SheetDescription className="font-mono text-xs">{selected.id}</SheetDescription>
              </SheetHeader>

              <Tabs defaultValue="summary" className="flex flex-1 flex-col">
                <TabsList>
                  <TabsTrigger value="summary">概览</TabsTrigger>
                  <TabsTrigger value="policies">策略 ({selected.policies_hit?.length ?? 0})</TabsTrigger>
                  <TabsTrigger value="raw">原始 JSON</TabsTrigger>
                </TabsList>

                <TabsContent value="summary" className="flex-1 overflow-y-auto pr-1">
                  <dl className="divide-y divide-border text-sm">
                    <DetailField label="时间" value={<span className="font-mono text-xs">{selected.event_time}</span>} />
                    <DetailField label="用户" value={selected.user_id ?? "—"} />
                    <DetailField label="模型" value={selected.model ?? "—"} />
                    <DetailField label="Provider" value={selected.provider ?? "—"} />
                    <DetailField label="租户" value={<span className="font-mono text-xs">{selected.tenant_id}</span>} />
                    <DetailField label="Session" value={<span className="font-mono text-xs">{selected.session_id ?? "—"}</span>} />
                    <DetailField label="Input tokens" value={<span className="font-mono">{selected.input_tokens ?? "—"}</span>} />
                    <DetailField label="Output tokens" value={<span className="font-mono">{selected.output_tokens ?? "—"}</span>} />
                    <DetailField label="耗时" value={selected.latency_ms ? `${selected.latency_ms} ms` : "—"} />
                  </dl>
                </TabsContent>

                <TabsContent value="policies" className="flex-1 overflow-y-auto pr-1">
                  {(selected.policies_hit?.length ?? 0) === 0 ? (
                    <EmptyState
                      icon={<ShieldCheck className="h-5 w-5" />}
                      title="未命中任何策略"
                      description="本次事件合规"
                      size="sm"
                      className="border-0"
                    />
                  ) : (
                    <div className="space-y-2">
                      {selected.policies_hit?.map((hit) => (
                        <div
                          key={hit.policy_id}
                          className="rounded-lg border border-danger/30 bg-danger-soft/30 p-3"
                        >
                          <div className="flex items-center gap-2">
                            <ShieldAlert className="h-4 w-4 text-danger" />
                            <span className="text-sm font-medium text-danger">{hit.policy_id}</span>
                            <Badge variant="soft" className="ml-auto text-[10px] uppercase">
                              {hit.severity}
                            </Badge>
                            <Badge
                              variant={hit.action === "block" ? "destructive" : hit.action === "redact" ? "warning" : "soft"}
                              className="text-[10px] uppercase"
                            >
                              {hit.action}
                            </Badge>
                          </div>
                          {hit.matched_rule ? (
                            <div className="mt-1 font-mono text-xs text-muted-foreground">rule: {hit.matched_rule}</div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="raw" className="flex-1 overflow-y-auto">
                  <pre className="whitespace-pre-wrap break-all rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs">
                    {JSON.stringify(selected, null, 2)}
                  </pre>
                </TabsContent>
              </Tabs>
            </div>
          ) : (
            <EmptyState
              icon={<Inbox className="h-5 w-5" />}
              title="请选择一条事件"
              description="从列表中点击任意行查看详情"
              size="sm"
              className="border-0"
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 py-2.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-foreground">{value}</dd>
    </div>
  );
}
