"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageHeader,
} from "@agenticx/ui";
import { useTranslations } from "next-intl";
import { adminFetch } from "../../../lib/admin-client-auth";

type JobRow = {
  id: string;
  name: string;
  cron: string;
  description: string;
};

type ScheduleRow = {
  id: string;
  job_id: string;
  cron: string;
  enabled: boolean;
};

type RunRow = {
  id: string;
  schedule_id: string;
  job_id: string;
  trigger: string;
  status: string;
  snapshot_id: string | null;
  error: string | null;
  started_at: string;
  finished_at: string;
  scheduled_for: string | null;
  replay_of_snapshot_id: string | null;
};

type WebhookEvent = { kind: string; payload: Record<string, unknown> };

const TRIGGER_LABEL: Record<string, string> = {
  schedule: "调度",
  manual: "重跑",
  backfill: "补数",
  replay: "快照回放",
};

const STATUS_LABEL: Record<string, string> = {
  succeeded: "成功",
  failed: "失败",
  running: "运行中",
};

export default function DataJobsSection() {
  const t = useTranslations("pages.admin.dataJobs");
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookEvent[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [fromApi, setFromApi] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [jobsRes, runsRes] = await Promise.all([
        adminFetch("/api/admin/data-suite/jobs"),
        adminFetch("/api/admin/data-suite/jobs/runs"),
      ]);
      if (!jobsRes.ok || !runsRes.ok) {
        setFromApi(false);
        setMessage(t("loadFailed"));
        return;
      }
      const jobsBody = (await jobsRes.json()) as {
        data: { jobs: JobRow[]; schedules: ScheduleRow[] };
      };
      const runsBody = (await runsRes.json()) as {
        data: { runs: RunRow[]; webhook_events: WebhookEvent[] };
      };
      setJobs(jobsBody.data.jobs ?? []);
      setSchedules(jobsBody.data.schedules ?? []);
      setRuns(runsBody.data.runs ?? []);
      setWebhooks(runsBody.data.webhook_events ?? []);
      setSelectedJobId((prev) => prev || jobsBody.data.jobs?.[0]?.id || "");
      setFromApi(true);
      setMessage("");
    } catch {
      setFromApi(false);
      setMessage(t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function postAction(body: Record<string, unknown>) {
    setBusy(true);
    setMessage("");
    try {
      const res = await adminFetch("/api/admin/data-suite/jobs/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { message?: string };
      if (!res.ok) {
        setMessage(json.message || t("actionFailed"));
        return;
      }
      setMessage(t("actionOk"));
      await refresh();
    } catch {
      setMessage(t("actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  const selectedSchedule = schedules.find((s) => s.job_id === selectedJobId);
  const lastSnap = runs.find((r) => r.job_id === selectedJobId && r.snapshot_id)?.snapshot_id;

  return (
    <div className="space-y-6" data-testid="data-jobs-page">
      <PageHeader title={t("title")} description={t("description")} />

      <Card data-testid="data-jobs-list">
        <CardHeader>
          <CardTitle>{t("jobsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">{t("loading")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="data-jobs-table">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">{t("col.jobId")}</th>
                    <th className="py-2 pr-4 font-medium">{t("col.cron")}</th>
                    <th className="py-2 pr-4 font-medium">{t("col.schedule")}</th>
                    <th className="py-2 font-medium">{t("col.description")}</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => {
                    const sch = schedules.find((s) => s.job_id === j.id);
                    return (
                      <tr
                        key={j.id}
                        className={`border-b last:border-0 cursor-pointer hover:bg-muted/40 ${
                          selectedJobId === j.id ? "bg-muted/30" : ""
                        }`}
                        data-testid={`data-jobs-row-${j.id}`}
                        onClick={() => setSelectedJobId(j.id)}
                      >
                        <td className="py-2 pr-4 font-mono text-xs">{j.id}</td>
                        <td className="py-2 pr-4 font-mono text-xs">{j.cron}</td>
                        <td className="py-2 pr-4 font-mono text-xs">{sch?.id ?? "—"}</td>
                        <td className="py-2">{j.description}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {fromApi ? (
            <p className="mt-4 text-xs text-muted-foreground" data-testid="data-jobs-api-source">
              {t("apiSource")}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card data-testid="data-jobs-actions">
        <CardHeader>
          <CardTitle>{t("actionsTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {t("selectedJob")}:{" "}
            <span className="font-mono text-xs" data-testid="data-jobs-selected">
              {selectedJobId || "—"}
            </span>
            {selectedSchedule ? (
              <>
                {" · "}
                {t("col.schedule")}:{" "}
                <span className="font-mono text-xs">{selectedSchedule.id}</span>
              </>
            ) : null}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={busy || !selectedJobId}
              data-testid="data-jobs-tick"
              onClick={() => void postAction({ action: "tick", job_id: selectedJobId })}
            >
              {t("tick")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy || !selectedJobId}
              data-testid="data-jobs-rerun"
              onClick={() => void postAction({ action: "rerun", job_id: selectedJobId })}
            >
              {t("rerun")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy || !selectedJobId}
              data-testid="data-jobs-backfill"
              onClick={() =>
                void postAction({
                  action: "backfill",
                  job_id: selectedJobId,
                  scheduled_for: "2026-10-01T03:00:00.000Z",
                })
              }
            >
              {t("backfill")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy || !selectedJobId || !lastSnap}
              data-testid="data-jobs-replay"
              onClick={() =>
                void postAction({
                  action: "replay",
                  job_id: selectedJobId,
                  snapshot_id: lastSnap,
                })
              }
            >
              {t("replay")}
            </Button>
          </div>
          {message ? (
            <p className="text-sm" data-testid="data-jobs-message">
              {message}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">{t("replayHint")}</p>
        </CardContent>
      </Card>

      <Card data-testid="data-jobs-runs">
        <CardHeader>
          <CardTitle>{t("runsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="data-jobs-runs-empty">
              {t("runsEmpty")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="data-jobs-runs-table">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">{t("col.runId")}</th>
                    <th className="py-2 pr-4 font-medium">{t("col.trigger")}</th>
                    <th className="py-2 pr-4 font-medium">{t("col.status")}</th>
                    <th className="py-2 pr-4 font-medium">{t("col.snapshot")}</th>
                    <th className="py-2 font-medium">{t("col.started")}</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b last:border-0"
                      data-testid={`data-jobs-run-${r.id}`}
                      data-status={r.status}
                      data-trigger={r.trigger}
                    >
                      <td className="py-2 pr-4 font-mono text-xs">{r.id}</td>
                      <td className="py-2 pr-4">{TRIGGER_LABEL[r.trigger] ?? r.trigger}</td>
                      <td className="py-2 pr-4">{STATUS_LABEL[r.status] ?? r.status}</td>
                      <td className="py-2 pr-4 font-mono text-xs">{r.snapshot_id ?? "—"}</td>
                      <td className="py-2 text-xs">{r.started_at}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="data-jobs-alerts">
        <CardHeader>
          <CardTitle>{t("alertsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {webhooks.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("alertsEmpty")}</p>
          ) : (
            <ul className="space-y-1 text-sm" data-testid="data-jobs-webhook-list">
              {webhooks.map((e, i) => (
                <li key={`${e.kind}-${i}`} className="font-mono text-xs">
                  {e.kind}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
