"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, toast } from "@agenticx/ui";

import { adminFetch } from "../../lib/admin-client-auth";
import type { EvalCandidateView } from "../../lib/ma/eval-records";

const STATUS_LABEL = { proposed: "待处理", applied: "已创建版本", discarded: "已丢弃" } as const;

export function CandidatesTab() {
  const [rows, setRows] = useState<EvalCandidateView[]>([]);
  const [active, setActive] = useState<EvalCandidateView | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await adminFetch("/api/admin/ma-evals/candidates", { cache: "no-store" });
    const json = (await res.json()) as { data?: { candidates?: EvalCandidateView[] } };
    setRows(json.data?.candidates ?? []);
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th>智能体</th><th>基线版本</th><th>来源任务</th><th>状态</th><th>创建时间</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-border">
              <td>{row.agent_id}</td>
              <td>v{row.base_version}</td>
              <td>{row.run_id}</td>
              <td>{row.status === "applied" ? `已创建版本 v${row.applied_version}` : STATUS_LABEL[row.status]}</td>
              <td>{row.created_at}</td>
              <td className="space-x-2">
                <Button type="button" size="sm" variant="outline" onClick={() => setActive(row)}>查看</Button>
                {row.status === "proposed" ? <Button type="button" size="sm" onClick={() => setConfirmId(row.id)}>创建候选版本</Button> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Dialog open={active != null} onOpenChange={(next) => { if (!next) setActive(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>候选差异</DialogTitle></DialogHeader>
          <p className="text-sm">{active?.rationale}</p>
          <pre className="max-h-80 overflow-auto font-mono text-xs">
            {(active?.diff.system ?? "").split("\n").map((line, index) => (
              <div key={`${index}-${line}`} className={line.startsWith("+") ? "text-green-600" : line.startsWith("-") ? "text-red-600" : ""}>{line}</div>
            ))}
          </pre>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmId != null} onOpenChange={(next) => { if (!next) setConfirmId(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>创建候选版本</DialogTitle></DialogHeader>
          <p>将基于该候选创建智能体的新版本。当前生效版本不变（若智能体跟随最新版本，会先固定在当前生效版本）。确认后可在新版本上回测，再到智能体页面手动切换生效版本。</p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmId(null)}>取消</Button>
            <Button type="button" onClick={() => {
              if (!confirmId) return;
              void adminFetch(`/api/admin/ma-evals/candidates/${confirmId}/apply`, { method: "POST" }).then(async (res) => {
                const json = (await res.json()) as { message?: string; data?: { version?: number; effective_version?: number } };
                if (!res.ok) {
                  toast.error(json.message ?? "创建失败");
                  return;
                }
                toast.success(`已创建版本 v${json.data?.version}，当前生效仍为 v${json.data?.effective_version}`);
                setConfirmId(null);
                await load();
              });
            }}>确认</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
