"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, Label, Progress, toast } from "@agenticx/ui";
import { useTranslations } from "next-intl";

import { adminFetch } from "../../lib/admin-client-auth";
import { evalProgressPercent, type EvalResultView, type EvalRunView } from "../../lib/ma/eval-records";
import { RunDetailSheet } from "./RunDetailSheet";

type Option = { id: string; name: string };

export function RunsTab({ initialRuns }: { initialRuns?: EvalRunView[] }) {
  const t = useTranslations("pages.admin.agentEvals");
  const tc = useTranslations("common");
  const [runs, setRuns] = useState<EvalRunView[]>(initialRuns ?? []);
  const [open, setOpen] = useState(false);
  const [agents, setAgents] = useState<Array<Option & { effectiveVersion?: number }>>([]);
  const [versions, setVersions] = useState<number[]>([]);
  const [environments, setEnvironments] = useState<Option[]>([]);
  const [datasets, setDatasets] = useState<Option[]>([]);
  const [rubrics, setRubrics] = useState<Option[]>([]);
  const [stores, setStores] = useState<Option[]>([]);
  const [form, setForm] = useState({ agentId: "", version: "", environmentId: "local", datasetId: "", rubricId: "", stores: [] as string[], concurrency: "2" });
  const [detail, setDetail] = useState<{ run: EvalRunView; results: EvalResultView[] } | null>(null);

  const load = useCallback(async () => {
    if (initialRuns) return;
    const res = await adminFetch("/api/admin/ma-evals/runs", { cache: "no-store" });
    const json = (await res.json()) as { data?: { runs?: EvalRunView[] } };
    setRuns(json.data?.runs ?? []);
  }, [initialRuns]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!runs.some((run) => run.status === "queued" || run.status === "running")) return;
    const timer = setInterval(() => { void load(); }, 3000);
    return () => clearInterval(timer);
  }, [load, runs]);

  useEffect(() => {
    setEnvironments([{ id: "local", name: t("runs.defaultCloud") }]);
  }, [t]);

  useEffect(() => {
    if (initialRuns) return;
    void adminFetch("/api/admin/agents", { cache: "no-store" }).then(async (res) => {
      const json = (await res.json()) as { data?: { agents?: Array<{ id: string; displayName?: string; name?: string; effectiveVersion?: number }> } };
      setAgents((json.data?.agents ?? []).map((agent) => ({ id: agent.id, name: agent.displayName || agent.name || agent.id, effectiveVersion: agent.effectiveVersion })));
    });
    void adminFetch("/api/admin/ma-environments", { cache: "no-store" }).then(async (res) => {
      const json = (await res.json()) as { data?: { environments?: Array<{ id: string; name: string; type: string }> } };
      const cloud = (json.data?.environments ?? []).filter((item) => item.type === "cloud").map((item) => ({ id: item.id, name: item.name }));
      setEnvironments([{ id: "local", name: t("runs.defaultCloud") }, ...cloud]);
    });
    void adminFetch("/api/admin/ma-evals/datasets", { cache: "no-store" }).then(async (res) => {
      const json = (await res.json()) as { data?: { datasets?: Option[] } };
      setDatasets((json.data?.datasets ?? []).map((item) => ({ id: item.id, name: item.name })));
    });
    void adminFetch("/api/admin/ma-evals/rubrics", { cache: "no-store" }).then(async (res) => {
      const json = (await res.json()) as { data?: { rubrics?: Option[] } };
      setRubrics((json.data?.rubrics ?? []).map((item) => ({ id: item.id, name: item.name })));
    });
    void adminFetch("/api/admin/ma-memory-stores", { cache: "no-store" }).then(async (res) => {
      const json = (await res.json()) as { data?: { memory_stores?: Array<{ id: string; name: string }> } };
      setStores((json.data?.memory_stores ?? []).map((item) => ({ id: item.id, name: item.name })));
    });
  }, [initialRuns, t]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button type="button" onClick={() => setOpen(true)}>{t("actions.startRun")}</Button></div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th>{t("columns.agentVersion")}</th>
            <th>{t("columns.dataset")}</th>
            <th>{t("columns.rubric")}</th>
            <th>{t("columns.status")}</th>
            <th>{t("columns.progress")}</th>
            <th>{t("columns.passRate")}</th>
            <th>{t("columns.meanScore")}</th>
            <th>{t("columns.startedAt")}</th>
            <th>{t("columns.actions")}</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const percent = evalProgressPercent(run.progress);
            return (
              <tr key={run.id} className="border-t border-border">
                <td>v{run.agent_version}</td>
                <td>{run.dataset_name}</td>
                <td>{run.rubric_name}</td>
                <td>{run.status}</td>
                <td className="min-w-32">
                  <Progress value={percent} data-value={percent} />
                  <span>{run.progress.done ?? 0}/{run.progress.total ?? 0}</span>
                </td>
                <td>{run.summary.pass_rate ?? "—"}</td>
                <td>{run.summary.mean_score ?? "—"}</td>
                <td>{run.created_at}</td>
                <td className="space-x-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => {
                    void adminFetch(`/api/admin/ma-evals/runs/${run.id}`, { cache: "no-store" }).then(async (res) => {
                      const json = (await res.json()) as { data?: { run?: EvalRunView; results?: EvalResultView[] } };
                      if (json.data?.run) setDetail({ run: json.data.run, results: json.data.results ?? [] });
                    });
                  }}>{t("actions.view")}</Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => {
                    void adminFetch(`/api/admin/ma-evals/runs/${run.id}/cancel`, { method: "POST" }).then(() => load());
                  }}>{tc("actions.cancel")}</Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => {
                    const model = window.prompt(t("placeholders.optimizerModel")) ?? "";
                    if (!model) return;
                    void adminFetch(`/api/admin/ma-evals/runs/${run.id}/iterate`, {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ optimizer_model: model }),
                    }).then(async (res) => {
                      if (!res.ok) toast.error(t("runs.iterateFailed"));
                      else toast.success(t("runs.iterateStarted"));
                    });
                  }}>{t("actions.iterate")}</Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("runs.startTitle")}</DialogTitle></DialogHeader>
          <Label>{t("fields.agent")}</Label>
          <select className="h-9 rounded-md border border-border bg-background px-2" value={form.agentId} onChange={(event) => {
            const agentId = event.target.value;
            const agent = agents.find((item) => item.id === agentId);
            setForm({ ...form, agentId, version: String(agent?.effectiveVersion ?? "") });
            void adminFetch(`/api/admin/agents/${agentId}/versions?limit=200`, { cache: "no-store" }).then(async (res) => {
              const json = (await res.json()) as { data?: { versions?: Array<{ version: number }> } };
              setVersions((json.data?.versions ?? []).map((item) => item.version));
            });
          }}>
            <option value="">{t("placeholders.selectAgent")}</option>
            {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
          </select>
          <Label>{t("fields.version")}</Label>
          <select className="h-9 rounded-md border border-border bg-background px-2" value={form.version} onChange={(event) => setForm({ ...form, version: event.target.value })}>
            {versions.map((version) => <option key={version} value={version}>v{version}</option>)}
          </select>
          <Label>{t("fields.environment")}</Label>
          <select className="h-9 rounded-md border border-border bg-background px-2" value={form.environmentId} onChange={(event) => setForm({ ...form, environmentId: event.target.value })}>
            {environments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <Label>{t("fields.dataset")}</Label>
          <select className="h-9 rounded-md border border-border bg-background px-2" value={form.datasetId} onChange={(event) => setForm({ ...form, datasetId: event.target.value })}>
            <option value="">{t("placeholders.selectDataset")}</option>
            {datasets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <Label>{t("fields.rubric")}</Label>
          <select className="h-9 rounded-md border border-border bg-background px-2" value={form.rubricId} onChange={(event) => setForm({ ...form, rubricId: event.target.value })}>
            <option value="">{t("placeholders.selectRubric")}</option>
            {rubrics.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <Label>{t("fields.memoryStores")}</Label>
          <div className="space-y-1">
            {stores.map((store) => (
              <label key={store.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.stores.includes(store.id)}
                  onChange={(event) => setForm({
                    ...form,
                    stores: event.target.checked ? [...form.stores, store.id] : form.stores.filter((id) => id !== store.id),
                  })}
                />
                {store.name}
              </label>
            ))}
          </div>
          <Label>{t("fields.concurrency")}</Label>
          <Input value={form.concurrency} onChange={(event) => setForm({ ...form, concurrency: event.target.value })} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>{tc("actions.cancel")}</Button>
            <Button type="button" onClick={() => {
              void adminFetch("/api/admin/ma-evals/runs", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  agent_id: form.agentId,
                  agent_version: Number(form.version),
                  environment_id: form.environmentId,
                  dataset_id: form.datasetId,
                  rubric_id: form.rubricId,
                  memory_store_ids: form.stores,
                  concurrency: Number(form.concurrency),
                }),
              }).then(async (res) => {
                const json = (await res.json()) as { message?: string };
                if (!res.ok) {
                  toast.error(json.message ?? t("runs.startFailed"));
                  return;
                }
                setOpen(false);
                await load();
              });
            }}>{t("actions.start")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <RunDetailSheet open={detail != null} onOpenChange={(next) => { if (!next) setDetail(null); }} run={detail?.run ?? null} results={detail?.results ?? []} />
    </div>
  );
}
