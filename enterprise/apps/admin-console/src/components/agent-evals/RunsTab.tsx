"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, Label, Progress, toast } from "@agenticx/ui";

import { adminFetch } from "../../lib/admin-client-auth";
import { evalProgressPercent, type EvalResultView, type EvalRunView } from "../../lib/ma/eval-records";
import { RunDetailSheet } from "./RunDetailSheet";

type Option = { id: string; name: string };

export function RunsTab({ initialRuns }: { initialRuns?: EvalRunView[] }) {
  const [runs, setRuns] = useState<EvalRunView[]>(initialRuns ?? []);
  const [open, setOpen] = useState(false);
  const [agents, setAgents] = useState<Array<Option & { effectiveVersion?: number }>>([]);
  const [versions, setVersions] = useState<number[]>([]);
  const [environments, setEnvironments] = useState<Option[]>([{ id: "local", name: "默认云端" }]);
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
    if (initialRuns) return;
    void adminFetch("/api/admin/agents", { cache: "no-store" }).then(async (res) => {
      const json = (await res.json()) as { data?: { agents?: Array<{ id: string; displayName?: string; name?: string; effectiveVersion?: number }> } };
      setAgents((json.data?.agents ?? []).map((agent) => ({ id: agent.id, name: agent.displayName || agent.name || agent.id, effectiveVersion: agent.effectiveVersion })));
    });
    void adminFetch("/api/admin/ma-environments", { cache: "no-store" }).then(async (res) => {
      const json = (await res.json()) as { data?: { environments?: Array<{ id: string; name: string; type: string }> } };
      const cloud = (json.data?.environments ?? []).filter((item) => item.type === "cloud").map((item) => ({ id: item.id, name: item.name }));
      setEnvironments([{ id: "local", name: "默认云端" }, ...cloud]);
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
  }, [initialRuns]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button type="button" onClick={() => setOpen(true)}>发起评测</Button></div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th>智能体与版本</th><th>评测集</th><th>评分标准</th><th>状态</th><th>进度</th><th>通过率</th><th>均分</th><th>发起时间</th><th>操作</th>
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
                  }}>查看</Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => {
                    void adminFetch(`/api/admin/ma-evals/runs/${run.id}/cancel`, { method: "POST" }).then(() => load());
                  }}>取消</Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => {
                    const model = window.prompt("优化模型（provider/model）") ?? "";
                    if (!model) return;
                    void adminFetch(`/api/admin/ma-evals/runs/${run.id}/iterate`, {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ optimizer_model: model }),
                    }).then(async (res) => {
                      if (!res.ok) toast.error("自迭代未开始");
                      else toast.success("已发起自迭代");
                    });
                  }}>自迭代</Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>发起评测</DialogTitle></DialogHeader>
          <Label>智能体</Label>
          <select className="h-9 rounded-md border border-border bg-background px-2" value={form.agentId} onChange={(event) => {
            const agentId = event.target.value;
            const agent = agents.find((item) => item.id === agentId);
            setForm({ ...form, agentId, version: String(agent?.effectiveVersion ?? "") });
            void adminFetch(`/api/admin/agents/${agentId}/versions?limit=200`, { cache: "no-store" }).then(async (res) => {
              const json = (await res.json()) as { data?: { versions?: Array<{ version: number }> } };
              setVersions((json.data?.versions ?? []).map((item) => item.version));
            });
          }}>
            <option value="">选择智能体</option>
            {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
          </select>
          <Label>版本</Label>
          <select className="h-9 rounded-md border border-border bg-background px-2" value={form.version} onChange={(event) => setForm({ ...form, version: event.target.value })}>
            {versions.map((version) => <option key={version} value={version}>v{version}</option>)}
          </select>
          <Label>环境</Label>
          <select className="h-9 rounded-md border border-border bg-background px-2" value={form.environmentId} onChange={(event) => setForm({ ...form, environmentId: event.target.value })}>
            {environments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <Label>评测集</Label>
          <select className="h-9 rounded-md border border-border bg-background px-2" value={form.datasetId} onChange={(event) => setForm({ ...form, datasetId: event.target.value })}>
            <option value="">选择评测集</option>
            {datasets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <Label>评分标准</Label>
          <select className="h-9 rounded-md border border-border bg-background px-2" value={form.rubricId} onChange={(event) => setForm({ ...form, rubricId: event.target.value })}>
            <option value="">选择评分标准</option>
            {rubrics.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <Label>记忆库（评测时只读挂载）</Label>
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
          <Label>并发数</Label>
          <Input value={form.concurrency} onChange={(event) => setForm({ ...form, concurrency: event.target.value })} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>取消</Button>
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
                  toast.error(json.message ?? "发起失败");
                  return;
                }
                setOpen(false);
                await load();
              });
            }}>发起</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <RunDetailSheet open={detail != null} onOpenChange={(next) => { if (!next) setDetail(null); }} run={detail?.run ?? null} results={detail?.results ?? []} />
    </div>
  );
}
