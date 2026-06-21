"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "../lib/admin-client-auth";
import {
  Badge,
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  toast,
} from "@agenticx/ui";
import { Check, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";

export type VisibleModelsTarget =
  | { kind: "user"; id: string; applyToDeptId?: string | null }
  | { kind: "dept"; id: string };

export type ModelOption = {
  id: string;
  provider: string;
  providerLabel: string;
  model: string;
  label: string;
};

type Props = {
  target: VisibleModelsTarget | null;
  title?: string;
  hint?: string;
  inheritedFromDept?: { deptLabel: string; modelIds: string[] } | null;
};

function modelsApiPath(target: VisibleModelsTarget): string {
  return target.kind === "user"
    ? `/api/admin/users/${target.id}/models`
    : `/api/admin/departments/${target.id}/models`;
}

export function VisibleModelsCard({ target, title, hint, inheritedFromDept }: Props) {
  const tUsers = useTranslations("pages.iam.users");
  const tDept = useTranslations("pages.iam.departments");

  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [applyingToDept, setApplyingToDept] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await adminFetch("/api/admin/providers", { cache: "no-store" });
        const json = (await res.json()) as {
          data?: {
            providers: Array<{
              id: string;
              displayName: string;
              enabled: boolean;
              models: Array<{ name: string; label: string; enabled: boolean }>;
            }>;
          };
        };
        if (!alive || !json.data) return;
        const opts: ModelOption[] = [];
        for (const p of json.data.providers) {
          if (!p.enabled) continue;
          for (const m of p.models) {
            if (!m.enabled) continue;
            opts.push({
              id: `${p.id}/${m.name}`,
              provider: p.id,
              providerLabel: p.displayName,
              model: m.name,
              label: m.label,
            });
          }
        }
        setModelOptions(opts);
      } catch {
        // 静默
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!target) {
      setSelectedIds([]);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const res = await adminFetch(modelsApiPath(target), { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { data?: { modelIds: string[] } };
        if (alive && json.data) setSelectedIds(json.data.modelIds);
      } catch {
        // 静默
      }
    })();
    return () => {
      alive = false;
    };
  }, [target?.kind, target?.id]);

  const persist = useCallback(
    async (next: string[]) => {
      if (!target) return;
      setSelectedIds(next);
      setSaving(true);
      try {
        const res = await adminFetch(modelsApiPath(target), {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ modelIds: next }),
        });
        const json = (await res.json()) as { data?: { modelIds: string[] }; message?: string };
        if (!res.ok || !json.data) {
          toast.error(json.message ?? tUsers("toast.saveFailed"));
          return;
        }
        setSelectedIds(json.data.modelIds);
      } finally {
        setSaving(false);
      }
    },
    [target, tUsers],
  );

  const handleToggle = (modelId: string) => {
    if (!target) return;
    const next = selectedIds.includes(modelId)
      ? selectedIds.filter((m) => m !== modelId)
      : [...selectedIds, modelId];
    void persist(next);
  };

  const handleApplyToDept = async () => {
    if (!target || target.kind !== "user" || !target.applyToDeptId) return;
    setApplyingToDept(true);
    try {
      const res = await adminFetch(`/api/admin/departments/${target.applyToDeptId}/models`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ modelIds: selectedIds }),
      });
      const json = (await res.json()) as { message?: string };
      if (!res.ok) {
        toast.error(json.message ?? tUsers("toast.saveFailed"));
        return;
      }
      toast.success(tUsers("detail.applyToDeptSuccess"));
    } finally {
      setApplyingToDept(false);
    }
  };

  const handleClearDept = async () => {
    if (!target || target.kind !== "dept") return;
    setSaving(true);
    try {
      const res = await adminFetch(modelsApiPath(target), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ modelIds: [] }),
      });
      const json = (await res.json()) as { data?: { modelIds: string[] }; message?: string };
      if (!res.ok || !json.data) {
        toast.error(json.message ?? tDept("toast.saveFailed"));
        return;
      }
      setSelectedIds([]);
      toast.success(tDept("visibleModels.cleared"));
    } finally {
      setSaving(false);
    }
  };

  const resolvedTitle =
    title ?? (target?.kind === "dept" ? tDept("visibleModels.title") : tUsers("detail.visibleModels"));
  const resolvedHint =
    hint ?? (target?.kind === "dept" ? tDept("visibleModels.hint") : tUsers("detail.visibleModelsExtraHint"));

  if (!target) return null;

  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            {resolvedTitle}
          </div>
          <div className="text-xs text-muted-foreground">{resolvedHint}</div>
        </div>
        <Badge variant="soft" className="text-[10px]">
          {tUsers("detail.selectedCount", { selected: selectedIds.length, total: modelOptions.length })}
        </Badge>
      </div>

      {inheritedFromDept ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex flex-wrap gap-1 rounded-md border border-dashed border-border bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground">
                {inheritedFromDept.modelIds.length > 0
                  ? tUsers("detail.inheritedFromDept", {
                      dept: inheritedFromDept.deptLabel,
                      count: inheritedFromDept.modelIds.length,
                    })
                  : tUsers("detail.inheritedFromDeptEmpty", { dept: inheritedFromDept.deptLabel })}
              </div>
            </TooltipTrigger>
            {inheritedFromDept.modelIds.length > 0 ? (
              <TooltipContent side="top" className="max-w-sm">
                <div className="space-y-0.5 font-mono text-[10px]">
                  {inheritedFromDept.modelIds.map((id) => (
                    <div key={id}>{id}</div>
                  ))}
                </div>
              </TooltipContent>
            ) : null}
          </Tooltip>
        </TooltipProvider>
      ) : null}

      {modelOptions.length === 0 ? (
        <p className="text-xs text-muted-foreground">{tUsers("detail.noModelsHint")}</p>
      ) : (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {modelOptions.map((opt) => {
            const checked = selectedIds.includes(opt.id);
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => handleToggle(opt.id)}
                disabled={saving}
                className={[
                  "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors",
                  checked
                    ? "border-primary bg-primary-soft/50 text-foreground"
                    : "border-border bg-surface-card hover:bg-muted",
                ].join(" ")}
              >
                <Check className={["h-3.5 w-3.5 shrink-0", checked ? "text-primary" : "opacity-0"].join(" ")} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{opt.label}</div>
                  <div className="truncate text-[10px] text-muted-foreground">
                    {opt.providerLabel} · <span className="font-mono">{opt.model}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        {target.kind === "user" && target.applyToDeptId ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={saving || applyingToDept}
            onClick={() => void handleApplyToDept()}
          >
            {tUsers("detail.applyToDept")}
          </Button>
        ) : null}
        {target.kind === "dept" ? (
          <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => void handleClearDept()}>
            {tDept("visibleModels.clear")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
