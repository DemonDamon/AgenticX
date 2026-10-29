"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageHeader,
  toast,
} from "@agenticx/ui";
import { useTranslations } from "next-intl";
import { adminFetch } from "../../../lib/admin-client-auth";
import {
  SAMPLE_SOURCES,
  type SourceWithStatus,
  type SyncReportRow,
} from "../../../lib/graph-incremental-types";

function sampleWithStatus(): SourceWithStatus[] {
  return SAMPLE_SOURCES.map((s) => ({
    ...s,
    content_hash: s.content_hash || "pending",
    fingerprint: s.content_hash || "pending",
    object_ids: [],
    last_sync_status: "never" as const,
  }));
}

export default function AdminGraphIncrementalSection() {
  const t = useTranslations("pages.admin.graphIncremental");
  const [sources, setSources] = useState<SourceWithStatus[]>(sampleWithStatus());
  const [runs, setRuns] = useState<SyncReportRow[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string>(
    SAMPLE_SOURCES[0]?.id ?? "",
  );
  const [selectedRunId, setSelectedRunId] = useState<string>("");
  const [report, setReport] = useState<SyncReportRow | null>(null);
  const [fromApi, setFromApi] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const [srcRes, runsRes] = await Promise.all([
        adminFetch("/api/admin/graph-incremental/sources"),
        adminFetch("/api/admin/graph-incremental/sync/runs"),
      ]);
      if (!srcRes.ok) throw new Error(`HTTP ${srcRes.status}`);
      if (!runsRes.ok) throw new Error(`HTTP ${runsRes.status}`);
      const srcJson = (await srcRes.json()) as { data?: { sources?: SourceWithStatus[] } };
      const runsJson = (await runsRes.json()) as { data?: { runs?: SyncReportRow[] } };
      const nextSources = srcJson.data?.sources?.length
        ? srcJson.data.sources
        : sampleWithStatus();
      const nextRuns = runsJson.data?.runs ?? [];
      setSources(nextSources);
      setRuns(nextRuns);
      setFromApi(Boolean(srcJson.data?.sources?.length));
      const prefer =
        nextSources.find((r) => r.id === selectedSourceId) ?? nextSources[0];
      if (prefer) setSelectedSourceId(prefer.id);
      const preferRun =
        nextRuns.find((r) => r.run_id === selectedRunId) ??
        nextRuns.find((r) => r.run_id === prefer?.last_run_id) ??
        nextRuns[0];
      if (preferRun) setSelectedRunId(preferRun.run_id);
    } catch {
      setSources(sampleWithStatus());
      setRuns([]);
      setFromApi(false);
      setSelectedSourceId(SAMPLE_SOURCES[0]?.id ?? "");
    } finally {
      setLoading(false);
    }
  }, [selectedSourceId, selectedRunId]);

  const loadReport = useCallback(async (runId: string) => {
    if (!runId) {
      setReport(null);
      return;
    }
    try {
      const res = await adminFetch(
        `/api/admin/graph-incremental/sync/runs/${encodeURIComponent(runId)}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { data?: { report?: SyncReportRow } };
      setReport(json.data?.report ?? null);
      setFromApi(true);
    } catch {
      setReport(null);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (selectedRunId) void loadReport(selectedRunId);
  }, [selectedRunId, loadReport]);

  const selectedSource = useMemo(
    () => sources.find((s) => s.id === selectedSourceId) ?? null,
    [sources, selectedSourceId],
  );

  async function doSeed() {
    setBusy(true);
    try {
      const res = await adminFetch("/api/admin/graph-incremental/seed", { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      toast.success(t("seedSuccess"));
      await loadList();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("seedFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function doMockSync(forceChanged: boolean) {
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        mode: "mock",
        actor: "admin",
      };
      if (forceChanged && selectedSourceId) {
        body.force_changed_ids = [selectedSourceId];
      }
      const res = await adminFetch("/api/admin/graph-incremental/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      const json = (await res.json()) as { data?: { report?: SyncReportRow } };
      toast.success(t("syncSuccess"));
      if (json.data?.report?.run_id) setSelectedRunId(json.data.report.run_id);
      await loadList();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("syncFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6" data-testid="graph-incremental-page">
      <PageHeader title={t("title")} description={t("description")} />
      <div className="flex flex-wrap gap-2">
        <Button
          data-testid="graph-incremental-seed"
          variant="secondary"
          disabled={busy}
          onClick={() => void doSeed()}
        >
          {t("seed")}
        </Button>
        <Button
          data-testid="graph-incremental-sync"
          disabled={busy}
          onClick={() => void doMockSync(false)}
        >
          {t("runSync")}
        </Button>
        <Button
          data-testid="graph-incremental-sync-force"
          variant="outline"
          disabled={busy || !selectedSourceId}
          onClick={() => void doMockSync(true)}
        >
          {t("runSyncForce")}
        </Button>
        <Button
          data-testid="graph-incremental-refresh"
          variant="ghost"
          disabled={busy}
          onClick={() => void loadList()}
        >
          {t("refresh")}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card data-testid="graph-incremental-list">
          <CardHeader>
            <CardTitle>{t("listTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">{t("loading")}</p>
            ) : (
              <table className="w-full text-sm" data-testid="graph-incremental-table">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-2 pr-2">{t("col.id")}</th>
                    <th className="py-2 pr-2">{t("col.status")}</th>
                    <th className="py-2 pr-2">{t("col.objects")}</th>
                    <th className="py-2">{t("col.hash")}</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((src) => (
                    <tr
                      key={src.id}
                      data-testid={`graph-incremental-row-${src.id}`}
                      className={
                        src.id === selectedSourceId
                          ? "cursor-pointer bg-muted/50"
                          : "cursor-pointer hover:bg-muted/30"
                      }
                      onClick={() => {
                        setSelectedSourceId(src.id);
                        if (src.last_run_id) setSelectedRunId(src.last_run_id);
                      }}
                    >
                      <td className="py-2 pr-2 font-mono text-xs">{src.id}</td>
                      <td className="py-2 pr-2">{src.last_sync_status}</td>
                      <td className="py-2 pr-2">{src.object_ids.length}</td>
                      <td className="py-2 font-mono text-xs">
                        {(src.fingerprint || src.content_hash || "").slice(0, 8)}…
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p
              className="mt-4 text-xs text-muted-foreground"
              data-testid="graph-incremental-source"
            >
              {fromApi ? t("apiSource") : t("stubNote")}
            </p>
          </CardContent>
        </Card>

        <Card data-testid="graph-incremental-detail">
          <CardHeader>
            <CardTitle>{t("detailTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {selectedSource ? (
              <>
                <div data-testid="graph-incremental-detail-id">
                  <span className="text-muted-foreground">{t("col.id")}: </span>
                  <span className="font-mono">{selectedSource.id}</span>
                </div>
                <div data-testid="graph-incremental-detail-status">
                  <span className="text-muted-foreground">{t("col.status")}: </span>
                  {selectedSource.last_sync_status}
                  {selectedSource.last_run_id ? ` · ${selectedSource.last_run_id}` : ""}
                </div>
                <div>
                  <span className="text-muted-foreground">{t("col.objects")}: </span>
                  <span className="font-mono text-xs">
                    {selectedSource.object_ids.join(", ") || "—"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t("col.content")}: </span>
                  <span className="text-xs">{selectedSource.content.slice(0, 120)}</span>
                </div>

                <div>
                  <h3 className="mb-2 font-medium">{t("runsTitle")}</h3>
                  {runs.length === 0 ? (
                    <p className="text-muted-foreground">{t("noRuns")}</p>
                  ) : (
                    <ul className="space-y-1" data-testid="graph-incremental-runs">
                      {runs.map((r) => (
                        <li key={r.run_id}>
                          <button
                            type="button"
                            data-testid={`graph-incremental-run-${r.run_id}`}
                            className={
                              r.run_id === selectedRunId
                                ? "font-mono text-xs underline"
                                : "font-mono text-xs text-muted-foreground hover:underline"
                            }
                            onClick={() => setSelectedRunId(r.run_id)}
                          >
                            {r.at} · {r.run_id} · +{r.added.length}/~{r.changed.length}/=
                            {r.unchanged.length} · extract {r.extracted_source_ids.length}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            ) : (
              <p className="text-muted-foreground">{t("noSelection")}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card data-testid="graph-incremental-sync-report">
        <CardHeader>
          <CardTitle>{t("reportTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {report ? (
            <>
              <div data-testid="graph-incremental-report-id" className="font-mono text-xs">
                {report.run_id} · {report.at}
              </div>
              <div data-testid="graph-incremental-changeset">
                <span className="text-muted-foreground">{t("changeset")}: </span>
                added[{report.added.join(", ") || "—"}] changed[
                {report.changed.join(", ") || "—"}] removed[{report.removed.join(", ") || "—"}]
                unchanged[{report.unchanged.length}]
              </div>
              <div>
                <span className="text-muted-foreground">{t("extracted")}: </span>
                <span className="font-mono text-xs">
                  {report.extracted_source_ids.join(", ") || "—"}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">{t("published")}: </span>
                <span className="font-mono text-xs">
                  {report.published_object_ids.join(", ") || "—"}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">{t("touched")}: </span>
                <span className="font-mono text-xs">
                  {report.touched_object_ids.join(", ") || "—"}
                </span>
              </div>
              <pre
                className="overflow-auto rounded border bg-muted/30 p-2 font-mono text-xs"
                data-testid="graph-incremental-graph-stats"
              >
                {JSON.stringify(report.graph_stats, null, 2)}
              </pre>
            </>
          ) : (
            <p className="text-muted-foreground">{t("noReport")}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
