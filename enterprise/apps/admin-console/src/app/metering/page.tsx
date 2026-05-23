"use client";
import { adminFetch } from "../../lib/admin-client-auth";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BarCard,
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
  Input,
  Label,
  LineCard,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  chartPalette,
  toast,
} from "@agenticx/ui";
import { useTranslations } from "next-intl";
import { BarChart3, Download, FileSpreadsheet, Filter, RefreshCcw, Search } from "lucide-react";

type MeteringRow = {
  dims: Record<string, string | null>;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cached_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  cost_usd: number;
};

type UserOption = { id: string; name: string; deptId: string | null };
type PatOption = { id: number; name: string; tokenPrefix: string };
type ProviderOption = { id: string; name: string; models: string[] };

const ALL = "__all__";

async function readJsonBody<T>(res: Response, fallback: T): Promise<T> {
  const raw = await res.text();
  if (!raw.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export default function MeteringPage() {
  const t = useTranslations("pages.ops.metering");
  const tc = useTranslations("common");
  const ts = useTranslations("shell");
  const [dept, setDept] = useState(ALL);
  const [user, setUser] = useState(ALL);
  const [apiToken, setApiToken] = useState(ALL);
  const [provider, setProvider] = useState(ALL);
  const [model, setModel] = useState(ALL);
  const [start, setStart] = useState(new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10));
  const [end, setEnd] = useState(new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<MeteringRow[]>([]);
  const [usersData, setUsersData] = useState<UserOption[]>([]);
  const [patOptions, setPatOptions] = useState<PatOption[]>([]);
  const [providersData, setProvidersData] = useState<ProviderOption[]>([]);
  const [loading, setLoading] = useState(false);

  const deptOptions = useMemo(() => {
    const buckets = new Set<string>();
    for (const row of rows) if (row.dims.dept) buckets.add(row.dims.dept);
    for (const item of usersData) if (item.deptId) buckets.add(item.deptId);
    return Array.from(buckets).sort();
  }, [rows, usersData]);

  const users = useMemo(() => {
    if (dept === ALL) return usersData;
    return usersData.filter((item) => item.deptId === dept);
  }, [dept, usersData]);

  const providers = useMemo(() => providersData, [providersData]);

  const models = useMemo(() => {
    if (provider === ALL) {
      const allModels = new Set<string>();
      for (const p of providersData) for (const m of p.models) allModels.add(m);
      return Array.from(allModels).sort();
    }
    return providersData.find((item) => item.id === provider)?.models ?? [];
  }, [provider, providersData]);

  useEffect(() => {
    let active = true;
    const loadMeta = async () => {
      try {
        const [usersRes, providersRes, patRes] = await Promise.all([
          adminFetch("/api/admin/users?limit=200", { cache: "no-store" }),
          adminFetch("/api/admin/providers", { cache: "no-store" }),
          adminFetch("/api/admin/api-tokens", { cache: "no-store" }),
        ]);
        const emptyUsers = { data: { items: [] as Array<{ id: string; displayName: string; deptId: string | null }> } };
        const emptyProviders = {
          data: {
            providers: [] as Array<{ id: string; displayName: string; enabled: boolean; models?: Array<{ name: string; enabled: boolean }> }>,
          },
        };
        const emptyPats = { data: { tokens: [] as Array<{ id: number; name: string; tokenPrefix: string }> } };
        const usersJson = await readJsonBody(usersRes, emptyUsers);
        const providersJson = await readJsonBody(providersRes, emptyProviders);
        const patJson = await readJsonBody(patRes, emptyPats);
        if (!active) return;
        setUsersData(
          (usersJson.data?.items ?? []).map((item) => ({
            id: item.id,
            name: item.displayName || item.id,
            deptId: item.deptId ?? null,
          }))
        );
        setPatOptions(
          (patJson.data?.tokens ?? []).map((item) => ({
            id: item.id,
            name: item.name,
            tokenPrefix: item.tokenPrefix,
          }))
        );
        setProvidersData(
          (providersJson.data?.providers ?? [])
            .filter((item) => item.enabled)
            .map((item) => ({
              id: item.id,
              name: item.displayName || item.id,
              models: (item.models ?? []).filter((modelItem) => modelItem.enabled).map((modelItem) => modelItem.name),
            }))
        );
      } catch {
        if (!active) return;
        setUsersData([]);
        setPatOptions([]);
        setProvidersData([]);
      }
    };
    void loadMeta();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (user !== ALL && !users.find((item) => item.id === user)) {
      setUser(ALL);
    }
  }, [users, user]);

  useEffect(() => {
    if (model !== ALL && !models.includes(model)) {
      setModel(ALL);
    }
  }, [models, model]);

  const query = useCallback(async () => {
    setLoading(true);
    try {
      const response = await adminFetch("/api/metering/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dept_id: dept !== ALL ? [dept] : [],
          user_id: user !== ALL ? [user] : [],
          api_token_id: apiToken !== ALL ? [apiToken] : [],
          provider: provider !== ALL ? [provider] : [],
          model: model !== ALL ? [model] : [],
          start: `${start}T00:00:00.000Z`,
          end: `${end}T23:59:59.999Z`,
          group_by: ["day", "dept", "user", "pat", "provider", "model"],
        }),
      });
      const payload = await readJsonBody<{ data?: { rows?: MeteringRow[] } }>(response, { data: { rows: [] } });
      setRows(payload.data?.rows ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("toast.queryFailed"));
    } finally {
      setLoading(false);
    }
  }, [dept, user, apiToken, provider, model, start, end]);

  useEffect(() => {
    void query();
  }, [query]);

  const exportCsv = async () => {
    const response = await adminFetch("/api/metering/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        dept_id: dept !== ALL ? [dept] : [],
        user_id: user !== ALL ? [user] : [],
        provider: provider !== ALL ? [provider] : [],
        model: model !== ALL ? [model] : [],
        start: `${start}T00:00:00.000Z`,
        end: `${end}T23:59:59.999Z`,
        group_by: ["day", "dept", "user", "provider", "model"],
      }),
    });
    const csv = await response.text();
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `metering-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success(t("toast.exportSuccess", { count: rows.length }));
  };

  const callsSeriesKey = t("callsSeries");
  const costSeriesKey = t("costSeries");

  const trendData = useMemo(
    () =>
      rows.map((row, index) => ({
        day: row.dims.day ?? `slot-${index + 1}`,
        [callsSeriesKey]: row.total_tokens,
        [costSeriesKey]: Number(row.cost_usd.toFixed(4)),
      })),
    [rows, callsSeriesKey, costSeriesKey]
  );

  const deptBarData = useMemo(
    () =>
      rows.map((row, index) => ({
        name: row.dims.day ?? `slot-${index + 1}`,
        tokens: row.total_tokens,
      })),
    [rows]
  );

  const totalTokens = rows.reduce((sum, row) => sum + row.total_tokens, 0);
  const totalCost = rows.reduce((sum, row) => sum + row.cost_usd, 0);

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
              <BreadcrumbItem>{t("breadcrumbOps")}</BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{t("breadcrumbMetering")}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void query()} disabled={loading}>
              <RefreshCcw />
              {tc("actions.refresh")}
            </Button>
            <Button size="sm" onClick={exportCsv}>
              <Download />
              {t("exportCsv")}
            </Button>
          </>
        }
      />

      {/* 筛选 chip 行 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Filter className="h-4 w-4" />
            {t("filtersTitle")}
          </CardTitle>
          <CardDescription>{t("filtersDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <div className="space-y-1.5">
            <Label>{t("dept")}</Label>
            <Select value={dept} onValueChange={setDept}>
              <SelectTrigger>
                <SelectValue placeholder={t("allDept")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("all")}</SelectItem>
                {deptOptions.map((deptId) => (
                  <SelectItem key={deptId} value={deptId}>
                    {deptId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t("user")}</Label>
            <Select value={user} onValueChange={setUser}>
              <SelectTrigger>
                <SelectValue placeholder={t("allUser")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("all")}</SelectItem>
                {users.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t("apiToken")}</Label>
            <Select value={apiToken} onValueChange={setApiToken}>
              <SelectTrigger>
                <SelectValue placeholder={t("allPat")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("all")}</SelectItem>
                {patOptions.map((item) => (
                  <SelectItem key={item.id} value={String(item.id)}>
                    {item.name} ({item.tokenPrefix}…)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t("provider")}</Label>
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger>
                <SelectValue placeholder={t("allProvider")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("all")}</SelectItem>
                {providers.map((providerItem) => (
                  <SelectItem key={providerItem.id} value={providerItem.id}>
                    {providerItem.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t("model")}</Label>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger>
                <SelectValue placeholder={t("allModel")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("all")}</SelectItem>
                {models.map((modelName) => (
                  <SelectItem key={modelName} value={modelName}>
                    {modelName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mt-start">{t("startDate")}</Label>
            <Input id="mt-start" type="date" value={start} onChange={(event) => setStart(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mt-end">{t("endDate")}</Label>
            <Input id="mt-end" type="date" value={end} onChange={(event) => setEnd(event.target.value)} />
          </div>
        </CardContent>
      </Card>

      {/* Summary */}
      <section className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-soft text-primary">
              <BarChart3 className="h-5 w-5" />
            </span>
            <div>
              <div className="text-xs text-muted-foreground">{t("totalTokens")}</div>
              <div className="text-xl font-semibold">{totalTokens.toLocaleString()}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-success-soft text-success">
              <FileSpreadsheet className="h-5 w-5" />
            </span>
            <div>
              <div className="text-xs text-muted-foreground">{t("totalCost")}</div>
              <div className="text-xl font-semibold">${totalCost.toFixed(4)}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning-soft text-warning-foreground">
              <Search className="h-5 w-5" />
            </span>
            <div>
              <div className="text-xs text-muted-foreground">{t("recordCount")}</div>
              <div className="text-xl font-semibold">{rows.length}</div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* 图表 + 表格 切换 */}
      <Tabs defaultValue="charts" className="space-y-4">
        <TabsList>
          <TabsTrigger value="charts">{t("tabCharts")}</TabsTrigger>
          <TabsTrigger value="table">{t("tabTable")}</TabsTrigger>
        </TabsList>

        <TabsContent value="charts" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <LineCard
              title={t("trendTitle")}
              description={t("trendDescription")}
              variant="area"
              data={trendData}
              xKey="day"
              series={[
                { key: t("callsSeries"), color: chartPalette[0] },
                { key: t("costSeries"), color: chartPalette[2] },
              ]}
              height={280}
            />
            <BarCard
              title={t("dailyTitle")}
              description={t("dailyDescription")}
              data={deptBarData}
              xKey="name"
              series={[{ key: "tokens", label: "Token", color: chartPalette[4] }]}
              height={280}
              hideLegend
            />
          </div>
        </TabsContent>

        <TabsContent value="table">
          <Card>
            <CardContent className="p-0">
              {rows.length === 0 ? (
                <EmptyState
                  icon={<FileSpreadsheet className="h-5 w-5" />}
                  title={loading ? t("emptyLoadingTitle") : t("emptyTitle")}
                  description={loading ? t("emptyLoadingDescription") : t("emptyDescription")}
                  size="default"
                  className="m-6 border-0"
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40">
                      <tr className="border-b border-border">
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("table.date")}</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("dept")}</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("table.user")}</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("model")}</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("table.tokens")}</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("table.cached")}</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("table.cacheRead")}</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("table.cacheWrite")}</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("costSeries")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, index) => (
                        <tr
                          key={`${row.dims.day ?? "na"}-${index}`}
                          className="border-b border-border last:border-0 hover:bg-muted/30"
                        >
                          <td className="px-4 py-2.5 font-mono text-xs">{row.dims.day ?? "-"}</td>
                          <td className="px-4 py-2.5">
                            <Badge variant="soft">{row.dims.dept ?? "—"}</Badge>
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground">{row.dims.user ?? "—"}</td>
                          <td className="px-4 py-2.5">
                            <Badge variant="soft" className="font-mono text-[10px]">
                              {row.dims.model ?? "—"}
                            </Badge>
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono">{row.total_tokens.toLocaleString()}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">{(row.cached_tokens ?? 0).toLocaleString()}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">{(row.cache_read_input_tokens ?? 0).toLocaleString()}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">{(row.cache_creation_input_tokens ?? 0).toLocaleString()}</td>
                          <td className="px-4 py-2.5 text-right font-mono">${row.cost_usd.toFixed(6)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-muted/40 font-medium">
                        <td colSpan={4} className="px-4 py-2.5 text-right text-muted-foreground">
                          {t("table.total")}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono">{totalTokens.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">—</td>
                        <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">—</td>
                        <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">—</td>
                        <td className="px-4 py-2.5 text-right font-mono">${totalCost.toFixed(4)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
