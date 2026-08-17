"use client";

import { adminFetch } from "../../../lib/admin-client-auth";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { TraceNode, TraceNodeKind, TraceTimeline } from "@agenticx/core-api";
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
  EmptyState,
  PageHeader,
  toast,
} from "@agenticx/ui";
import { ChevronDown, ChevronRight, Copy, GitBranch, Inbox } from "lucide-react";
import { useTranslations } from "next-intl";

function kindBadgeVariant(
  kind: TraceNodeKind,
  status?: string,
): "destructive" | "secondary" | "outline" {
  if (status === "failed" || status === "error" || status === "500") return "destructive";
  if (kind === "model_step") return "outline";
  if (kind === "dr_lane") return "outline";
  return "secondary";
}

function TraceNodeRow({
  node,
  depth,
  tKind,
  tExpand,
  tCollapse,
}: {
  node: TraceNode;
  depth: number;
  tKind: (key: TraceNodeKind) => string;
  tExpand: string;
  tCollapse: string;
}) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  const failed =
    node.status === "failed" ||
    node.status === "error" ||
    (typeof node.status === "string" && node.status.startsWith("5"));

  return (
    <div className="border-b border-border last:border-b-0">
      <div
        className="flex items-start gap-2 px-3 py-2 hover:bg-muted/40"
        style={{ paddingLeft: 12 + depth * 16 }}
      >
        <button
          type="button"
          className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground disabled:opacity-30"
          disabled={!hasChildren}
          aria-label={open ? tCollapse : tExpand}
          onClick={() => setOpen((v) => !v)}
        >
          {hasChildren ? (
            open ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )
          ) : (
            <span className="h-3.5 w-3.5" />
          )}
        </button>
        <Badge variant={kindBadgeVariant(node.kind, node.status)} className="shrink-0">
          {tKind(node.kind)}
        </Badge>
        <div className="min-w-0 flex-1">
          <div className={`truncate text-sm ${failed ? "text-destructive" : ""}`}>{node.label}</div>
          {open && node.attrs ? (
            <div className="mt-1 space-y-1 text-xs text-muted-foreground">
              {node.kind === "model_step" ? (
                <div className="font-mono">
                  {String(node.attrs.provider ?? "—")}/{String(node.attrs.model ?? "—")}
                  {node.tokens
                    ? ` · in ${node.tokens.input} / out ${node.tokens.output} / total ${node.tokens.total}`
                    : ""}
                  {node.attrs.error_message ? (
                    <div className="mt-1 text-destructive">{String(node.attrs.error_message)}</div>
                  ) : null}
                </div>
              ) : null}
              {node.kind === "dr_lane" && Array.isArray((node.attrs as { sources?: unknown }).sources) ? (
                <ul className="list-disc pl-4">
                  {(
                    (node.attrs as { sources?: Array<{ title?: string; url?: string }> }).sources ?? []
                  ).map((src, idx) => (
                    <li key={`${src.url ?? src.title ?? idx}`}>
                      {src.url ? (
                        <a href={src.url} target="_blank" rel="noreferrer" className="underline">
                          {src.title || src.url}
                        </a>
                      ) : (
                        src.title || "—"
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
              {node.kind === "dr_event" &&
              Array.isArray((node.attrs as { sources?: unknown }).sources) ? (
                <ul className="list-disc pl-4">
                  {(
                    (node.attrs as { sources?: Array<{ title?: string; url?: string }> }).sources ?? []
                  ).map((src, idx) => (
                    <li key={`${src.url ?? src.title ?? idx}`}>
                      {src.url ? (
                        <a href={src.url} target="_blank" rel="noreferrer" className="underline">
                          {src.title || src.url}
                        </a>
                      ) : (
                        src.title || "—"
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="shrink-0 text-right font-mono text-xs text-muted-foreground">
          {node.durationMs != null ? <div>{node.durationMs}ms</div> : null}
          {node.tokens ? <div>{node.tokens.total} tok</div> : null}
        </div>
      </div>
      {open && hasChildren
        ? node.children.map((child) => (
            <TraceNodeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              tKind={tKind}
              tExpand={tExpand}
              tCollapse={tCollapse}
            />
          ))
        : null}
    </div>
  );
}

export default function TraceRuntimePage() {
  const t = useTranslations("pages.ops.traceRuntime");
  const ts = useTranslations("shell");
  const params = useParams<{ traceId: string }>();
  const traceId = useMemo(() => String(params.traceId ?? "").trim(), [params.traceId]);

  const [data, setData] = useState<TraceTimeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [invalid, setInvalid] = useState(false);

  const load = useCallback(async () => {
    if (!traceId) {
      setInvalid(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    setForbidden(false);
    setInvalid(false);
    try {
      const response = await adminFetch(`/api/traces/${encodeURIComponent(traceId)}`);
      if (response.status === 401 || response.status === 403) {
        setForbidden(true);
        setData(null);
        return;
      }
      if (response.status === 400) {
        setInvalid(true);
        setData(null);
        return;
      }
      const payload = (await response.json()) as {
        code?: string;
        data?: TraceTimeline;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(payload.message ?? t("toast.loadFailed"));
      }
      setData(payload.data ?? null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("toast.loadFailed"));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [traceId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/dashboard">{ts("nav.groups.ops")}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{t("breadcrumb")}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" asChild>
              <Link href={`/portal-logs?trace_id=${encodeURIComponent(traceId)}`}>
                {t("backPortalLogs")}
              </Link>
            </Button>
            <Button type="button" variant="outline" size="sm" asChild>
              <Link href={`/audit?trace_id=${encodeURIComponent(traceId)}`}>{t("backAudit")}</Link>
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 pt-4">
          <GitBranch className="h-4 w-4 text-muted-foreground" />
          <span className="font-mono text-sm">{traceId || "—"}</span>
          {traceId ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={() => {
                void navigator.clipboard.writeText(traceId).then(() => {
                  toast.success(t("toast.copied"));
                });
              }}
            >
              <Copy className="mr-1 h-3.5 w-3.5" />
              {t("copyTraceId")}
            </Button>
          ) : null}
          {data ? (
            <div className="ml-auto flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span>
                {t("totals.steps")}: <span className="font-mono text-foreground">{data.totals.steps}</span>
              </span>
              <span>
                {t("totals.tokens")}:{" "}
                <span className="font-mono text-foreground">{data.totals.tokens}</span>
              </span>
              <span>
                {t("totals.cost")}:{" "}
                <span className="font-mono text-foreground">{data.totals.cost_usd.toFixed(6)}</span>
              </span>
              <span>
                {t("totals.duration")}:{" "}
                <span className="font-mono text-foreground">
                  {data.totals.duration_ms != null ? `${data.totals.duration_ms}ms` : "—"}
                </span>
              </span>
              <span>
                {t("sources.portal")}: {data.sources.portal_logs} · {t("sources.model")}:{" "}
                {data.sources.model_steps} · {t("sources.deepResearch")}:{" "}
                {data.sources.deep_research_run ? "yes" : "no"}
              </span>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {forbidden ? (
        <EmptyState
          icon={<Inbox className="h-8 w-8" />}
          title={t("forbiddenTitle")}
          description={t("forbiddenDescription")}
        />
      ) : invalid ? (
        <EmptyState
          icon={<Inbox className="h-8 w-8" />}
          title={t("invalidTitle")}
          description={t("invalidDescription")}
        />
      ) : loading ? (
        <EmptyState
          icon={<GitBranch className="h-8 w-8" />}
          title={t("loading")}
          description={t("description")}
        />
      ) : !data || data.nodes.length === 0 ? (
        <EmptyState
          icon={<Inbox className="h-8 w-8" />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            {data.nodes.map((node) => (
              <TraceNodeRow
                key={node.id}
                node={node}
                depth={0}
                tKind={(kind) => t(`kind.${kind}`)}
                tExpand={t("expand")}
                tCollapse={t("collapse")}
              />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
