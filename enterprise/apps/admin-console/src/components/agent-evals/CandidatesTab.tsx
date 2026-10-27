"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, toast } from "@agenticx/ui";
import { useTranslations } from "next-intl";

import { adminFetch } from "../../lib/admin-client-auth";
import type { EvalCandidateView } from "../../lib/ma/eval-records";

export function CandidatesTab() {
  const t = useTranslations("pages.admin.agentEvals");
  const tc = useTranslations("common");
  const [rows, setRows] = useState<EvalCandidateView[]>([]);
  const [active, setActive] = useState<EvalCandidateView | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await adminFetch("/api/admin/ma-evals/candidates", { cache: "no-store" });
    const json = (await res.json()) as { data?: { candidates?: EvalCandidateView[] } };
    setRows(json.data?.candidates ?? []);
  }, []);

  useEffect(() => { void load(); }, [load]);

  function statusLabel(row: EvalCandidateView): string {
    if (row.status === "applied") return t("candidates.appliedVersion", { version: row.applied_version });
    return t(`candidates.status.${row.status}`);
  }

  return (
    <div className="space-y-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th>{t("columns.agent")}</th>
            <th>{t("columns.baseVersion")}</th>
            <th>{t("columns.sourceRun")}</th>
            <th>{t("columns.status")}</th>
            <th>{t("columns.createdAt")}</th>
            <th>{t("columns.actions")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-border">
              <td>{row.agent_id}</td>
              <td>v{row.base_version}</td>
              <td>{row.run_id}</td>
              <td>{statusLabel(row)}</td>
              <td>{row.created_at}</td>
              <td className="space-x-2">
                <Button type="button" size="sm" variant="outline" onClick={() => setActive(row)}>{t("actions.view")}</Button>
                {row.status === "proposed" ? (
                  <Button type="button" size="sm" onClick={() => setConfirmId(row.id)}>{t("actions.applyCandidate")}</Button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Dialog open={active != null} onOpenChange={(next) => { if (!next) setActive(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>{t("candidates.diffTitle")}</DialogTitle></DialogHeader>
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
          <DialogHeader><DialogTitle>{t("candidates.applyTitle")}</DialogTitle></DialogHeader>
          <p>{t("candidates.applyConfirm")}</p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmId(null)}>{tc("actions.cancel")}</Button>
            <Button type="button" onClick={() => {
              if (!confirmId) return;
              void adminFetch(`/api/admin/ma-evals/candidates/${confirmId}/apply`, { method: "POST" }).then(async (res) => {
                const json = (await res.json()) as { message?: string; data?: { version?: number; effective_version?: number } };
                if (!res.ok) {
                  toast.error(json.message ?? t("candidates.applyFailed"));
                  return;
                }
                toast.success(t("candidates.applySuccess", { version: json.data?.version, effective: json.data?.effective_version }));
                setConfirmId(null);
                await load();
              });
            }}>{tc("actions.confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
