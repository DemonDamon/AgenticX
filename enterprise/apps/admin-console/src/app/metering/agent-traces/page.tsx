"use client";

import { adminFetch } from "../../../lib/admin-client-auth";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
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
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@agenticx/ui";
import { RefreshCcw, Search } from "lucide-react";
import { useTranslations } from "next-intl";

type TraceSpan = {
  step_no: number;
  step_kind: string;
  status: string;
  model: string | null;
  provider: string | null;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  cost_usd: string;
  duration_ms: number;
  error_message: string | null;
};

type TraceDetail = {
  trace_id: string;
  status: string;
  spans: TraceSpan[];
  total_usage: {
    input_tokens: number;
    output_tokens: number;
    reasoning_tokens: number;
    total_tokens: number;
    cost_usd: number;
  };
};

export default function AgentTracesPage() {
  const t = useTranslations("pages.ops.agentTraces");
  const [traceIds, setTraceIds] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [queryId, setQueryId] = useState("");
  const [detail, setDetail] = useState<TraceDetail | null>(null);
  const [loading, setLoading] = useState(false);

  const loadIds = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch("/api/agent-traces", { cache: "no-store" });
      const json = (await res.json()) as { data?: { trace_ids?: string[] } };
      setTraceIds(json.data?.trace_ids ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (traceId: string) => {
    if (!traceId.trim()) return;
    setLoading(true);
    try {
      const res = await adminFetch(`/api/agent-traces?trace_id=${encodeURIComponent(traceId)}`, { cache: "no-store" });
      if (!res.ok) {
        setDetail(null);
        return;
      }
      const json = (await res.json()) as { data?: TraceDetail };
      setDetail(json.data ?? null);
      setSelectedId(traceId);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadIds();
  }, [loadIds]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        breadcrumb={
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link href="/metering">{t("breadcrumbMetering")}</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{t("title")}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        actions={
          <Button variant="outline" size="sm" onClick={() => void loadIds()} disabled={loading}>
            <RefreshCcw className="mr-2 h-4 w-4" />
            {t("refresh")}
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("recentTraces")}</CardTitle>
            <CardDescription>{t("recentTracesHint")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {traceIds.length === 0 ? (
              <EmptyState title={t("empty")} />
            ) : (
              traceIds.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => void loadDetail(id)}
                  className={`w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted ${selectedId === id ? "bg-muted font-medium" : ""}`}
                >
                  {id}
                </button>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("traceDetail")}</CardTitle>
            <CardDescription>{t("traceDetailHint")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <div className="flex-1 space-y-1">
                <Label htmlFor="trace-id">{t("traceId")}</Label>
                <Input id="trace-id" value={queryId} onChange={(e) => setQueryId(e.target.value)} placeholder="trace_..." />
              </div>
              <div className="flex items-end">
                <Button onClick={() => void loadDetail(queryId)} disabled={loading || !queryId.trim()}>
                  <Search className="mr-2 h-4 w-4" />
                  {t("lookup")}
                </Button>
              </div>
            </div>

            {!detail ? (
              <EmptyState title={t("selectTrace")} />
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-4">
                  <Stat label={t("status")} value={detail.status} />
                  <Stat label={t("totalTokens")} value={String(detail.total_usage.total_tokens)} />
                  <Stat label={t("inputTokens")} value={String(detail.total_usage.input_tokens)} />
                  <Stat label={t("costUsd")} value={detail.total_usage.cost_usd.toFixed(6)} />
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("step")}</TableHead>
                      <TableHead>{t("kind")}</TableHead>
                      <TableHead>{t("status")}</TableHead>
                      <TableHead>{t("model")}</TableHead>
                      <TableHead className="text-right">{t("tokens")}</TableHead>
                      <TableHead className="text-right">{t("costUsd")}</TableHead>
                      <TableHead className="text-right">{t("duration")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.spans.map((span) => (
                      <TableRow key={span.step_no}>
                        <TableCell>{span.step_no}</TableCell>
                        <TableCell>{span.step_kind}</TableCell>
                        <TableCell>{span.status}</TableCell>
                        <TableCell>{span.model ?? "—"}</TableCell>
                        <TableCell className="text-right">{span.total_tokens}</TableCell>
                        <TableCell className="text-right">{Number(span.cost_usd).toFixed(6)}</TableCell>
                        <TableCell className="text-right">{span.duration_ms}ms</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}
