"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { adminFetch } from "../lib/admin-client-auth";
import {
  Badge,
  Button,
  SheetFooter,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  toast,
} from "@agenticx/ui";
import { Check, ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";

export type VisibleModelsTarget =
  | { kind: "user"; id: string; deptId: string | null }
  | { kind: "dept"; id: string };

type ModelOption = {
  id: string;
  provider: string;
  providerLabel: string;
  model: string;
  label: string;
};

type ModelsPayload = {
  modelIds: string[];
  parentAllowedIds: string[];
  parentLabel: string;
  parentSourceLabel?: string;
  prunedModelIds?: string[];
};

type Props = {
  target: VisibleModelsTarget;
  variant?: "sheet" | "inline";
  onClose?: () => void;
  onSaved?: () => void;
};

function modelsApiPath(target: VisibleModelsTarget): string {
  return target.kind === "user"
    ? `/api/admin/users/${target.id}/models`
    : `/api/admin/departments/${target.id}/models`;
}

function parentLabelText(label: string, tDept: ReturnType<typeof useTranslations<"pages.iam.departments">>): string {
  if (label === "__ALL_ENABLED__") return tDept("visibleModels.allEnabledParent");
  return label;
}

export function VisibleModelsEditor({ target, variant = "sheet", onClose, onSaved }: Props) {
  const tUsers = useTranslations("pages.iam.users");
  const tDept = useTranslations("pages.iam.departments");

  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [draftIds, setDraftIds] = useState<string[]>([]);
  const [parentAllowedIds, setParentAllowedIds] = useState<string[]>([]);
  const [parentLabel, setParentLabel] = useState("");
  const [prunedModelIds, setPrunedModelIds] = useState<string[]>([]);
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set());
  const [inlineExpanded, setInlineExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const parentAllowedSet = useMemo(() => new Set(parentAllowedIds), [parentAllowedIds]);

  const grouped = useMemo(() => {
    const map = new Map<string, { providerLabel: string; models: ModelOption[] }>();
    for (const opt of modelOptions) {
      const entry = map.get(opt.provider) ?? { providerLabel: opt.providerLabel, models: [] };
      entry.models.push(opt);
      map.set(opt.provider, entry);
    }
    return map;
  }, [modelOptions]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [providersRes, modelsRes] = await Promise.all([
        adminFetch("/api/admin/providers", { cache: "no-store" }),
        adminFetch(modelsApiPath(target), { cache: "no-store" }),
      ]);
      const providersJson = (await providersRes.json()) as {
        data?: {
          providers: Array<{
            id: string;
            displayName: string;
            enabled: boolean;
            models: Array<{ name: string; label: string; enabled: boolean }>;
          }>;
        };
      };
      const modelsJson = (await modelsRes.json()) as { data?: ModelsPayload };

      const opts: ModelOption[] = [];
      for (const p of providersJson.data?.providers ?? []) {
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

      if (modelsJson.data) {
        const ids = modelsJson.data.modelIds ?? [];
        setSelectedIds(ids);
        setDraftIds(ids);
        setParentAllowedIds(modelsJson.data.parentAllowedIds ?? []);
        setParentLabel(modelsJson.data.parentLabel ?? modelsJson.data.parentSourceLabel ?? "");
        setPrunedModelIds(modelsJson.data.prunedModelIds ?? []);
      }

      const allProviders = new Set(opts.map((o) => o.provider));
      setExpandedProviders(allProviders);
    } finally {
      setLoading(false);
    }
  }, [target]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const persist = useCallback(
    async (next: string[]) => {
      setSaving(true);
      try {
        const res = await adminFetch(modelsApiPath(target), {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ modelIds: next }),
        });
        const json = (await res.json()) as {
          data?: { modelIds: string[]; prunedModelIds?: string[] };
          message?: string;
        };
        if (!res.ok || !json.data) {
          toast.error(json.message ?? tUsers("toast.saveFailed"));
          return false;
        }
        setSelectedIds(json.data.modelIds);
        setDraftIds(json.data.modelIds);
        setPrunedModelIds(json.data.prunedModelIds ?? []);
        onSaved?.();
        return true;
      } finally {
        setSaving(false);
      }
    },
    [target, tUsers, onSaved],
  );

  const handleToggle = (modelId: string) => {
    if (!parentAllowedSet.has(modelId)) return;
    if (variant === "sheet") {
      setDraftIds((prev) =>
        prev.includes(modelId) ? prev.filter((m) => m !== modelId) : [...prev, modelId],
      );
      return;
    }
    const next = selectedIds.includes(modelId)
      ? selectedIds.filter((m) => m !== modelId)
      : [...selectedIds, modelId];
    void persist(next);
  };

  const handleSaveSheet = async () => {
    const ok = await persist(draftIds);
    if (ok) {
      toast.success(tDept("toast.saved"));
      onClose?.();
    }
  };

  const toggleProvider = (providerId: string) => {
    setExpandedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(providerId)) next.delete(providerId);
      else next.add(providerId);
      return next;
    });
  };

  const selectAllInProvider = (providerId: string) => {
    const models = grouped.get(providerId)?.models ?? [];
    const allowed = models.filter((m) => parentAllowedSet.has(m.id)).map((m) => m.id);
    if (variant === "sheet") {
      setDraftIds((prev) => [...new Set([...prev, ...allowed])]);
      return;
    }
    void persist([...new Set([...selectedIds, ...allowed])]);
  };

  const clearProvider = (providerId: string) => {
    const ids = new Set((grouped.get(providerId)?.models ?? []).map((m) => m.id));
    if (variant === "sheet") {
      setDraftIds((prev) => prev.filter((id) => !ids.has(id)));
      return;
    }
    void persist(selectedIds.filter((id) => !ids.has(id)));
  };

  const activeIds = variant === "sheet" ? draftIds : selectedIds;

  const editorBody = (
    <div className="space-y-3">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="inline-flex max-w-full items-center gap-1 rounded-md border border-dashed border-border bg-muted/30 px-2 py-1 text-xs text-muted-foreground">
              <Sparkles className="h-3 w-3 shrink-0 text-primary" />
              {tDept("visibleModels.parentAllowed", {
                count: parentAllowedIds.length,
                label: parentLabelText(parentLabel, tDept),
              })}
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-h-48 max-w-sm overflow-y-auto">
            <div className="space-y-0.5 font-mono text-[10px]">
              {parentAllowedIds.length === 0 ? (
                <div>{tDept("visibleModels.noParentAllowed")}</div>
              ) : (
                parentAllowedIds.map((id) => <div key={id}>{id}</div>)
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {prunedModelIds.length > 0 ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-xs text-destructive">
          {tUsers("detail.prunedHint")}
          <div className="mt-1 font-mono text-[10px]">{prunedModelIds.join(", ")}</div>
        </div>
      ) : null}

      {loading ? (
        <p className="text-xs text-muted-foreground">{tUsers("detail.loadingModels")}</p>
      ) : modelOptions.length === 0 ? (
        <p className="text-xs text-muted-foreground">{tUsers("detail.noModelsHint")}</p>
      ) : (
        <div className="space-y-2">
          {[...grouped.entries()].map(([providerId, group]) => {
            const expanded = expandedProviders.has(providerId);
            const selectable = group.models.filter((m) => parentAllowedSet.has(m.id));
            const selectedInGroup = selectable.filter((m) => activeIds.includes(m.id)).length;
            return (
              <div key={providerId} className="rounded-lg border border-border">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/20 px-3 py-2">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm font-semibold"
                    onClick={() => toggleProvider(providerId)}
                  >
                    {expanded ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate">{group.providerLabel}</span>
                    <Badge variant="soft" className="text-[10px] font-normal">
                      {tDept("visibleModels.providerSelected", {
                        selected: selectedInGroup,
                        total: selectable.length,
                      })}
                    </Badge>
                  </button>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={saving || selectable.length === 0}
                      onClick={() => selectAllInProvider(providerId)}
                    >
                      {tDept("visibleModels.providerSelectAll")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={saving}
                      onClick={() => clearProvider(providerId)}
                    >
                      {tDept("visibleModels.providerClear")}
                    </Button>
                  </div>
                </div>
                {expanded ? (
                  <div className="grid gap-1.5 p-2 sm:grid-cols-2">
                    {group.models.map((opt) => {
                      const checked = activeIds.includes(opt.id);
                      const outOfParent = !parentAllowedSet.has(opt.id);
                      const btn = (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => handleToggle(opt.id)}
                          disabled={saving || outOfParent}
                          className={[
                            "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors",
                            outOfParent
                              ? "cursor-not-allowed border-border/50 bg-muted/40 text-muted-foreground opacity-60"
                              : checked
                                ? "border-primary bg-primary-soft/50 text-foreground"
                                : "border-border bg-surface-card hover:bg-muted",
                          ].join(" ")}
                        >
                          <Check
                            className={["h-3.5 w-3.5 shrink-0", checked && !outOfParent ? "text-primary" : "opacity-0"].join(
                              " ",
                            )}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium">{opt.label}</div>
                            <div className="truncate font-mono text-[10px] text-muted-foreground">{opt.model}</div>
                          </div>
                        </button>
                      );
                      if (!outOfParent) return btn;
                      return (
                        <TooltipProvider key={opt.id}>
                          <Tooltip>
                            <TooltipTrigger asChild>{btn}</TooltipTrigger>
                            <TooltipContent>{tDept("visibleModels.outOfParent")}</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {variant === "sheet" ? (
        <SheetFooter className="gap-2 sm:justify-end">
          <Button type="button" variant="outline" disabled={saving} onClick={() => onClose?.()}>
            {tDept("visibleModels.cancel")}
          </Button>
          <Button type="button" disabled={saving || loading} onClick={() => void handleSaveSheet()}>
            {tDept("visibleModels.save")}
          </Button>
        </SheetFooter>
      ) : null}
    </div>
  );

  if (variant === "inline") {
    return (
      <div className="space-y-2 rounded-lg border border-border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold">{tUsers("detail.visibleModels")}</div>
          {!inlineExpanded ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="soft" className="text-[10px]">
                {tUsers("detail.visibleModelsSummary", {
                  selected: selectedIds.length,
                  parentAllowed: parentAllowedIds.length,
                })}
              </Badge>
              <Button type="button" variant="outline" size="sm" onClick={() => setInlineExpanded(true)}>
                {tUsers("detail.visibleModelsConfigure")}
              </Button>
            </div>
          ) : (
            <Button type="button" variant="ghost" size="sm" onClick={() => setInlineExpanded(false)}>
              {tDept("visibleModels.collapse")}
            </Button>
          )}
        </div>
        {inlineExpanded ? editorBody : null}
      </div>
    );
  }

  return editorBody;
}
