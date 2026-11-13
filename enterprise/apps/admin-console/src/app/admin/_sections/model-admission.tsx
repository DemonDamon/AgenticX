"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Checkbox,
  Input,
  Label,
  toast,
} from "@agenticx/ui";
import { useTranslations } from "next-intl";

type Threshold = { enabled: boolean; minScore: number; requireScorecard: boolean };

type ScorecardEntry = {
  model: string;
  provider: string;
  runId: string;
  createdAt: string;
  corpusVersion: string;
  safetyScore: number;
  grade: string;
  attempts: number;
  refused: number;
  blockedByRule: number;
  bypassed: number;
  errors: number;
  source: string;
};

type OverrideRecord = {
  model: string;
  operator: string;
  reason: string;
  ticket?: string;
  at: string;
  scoreAtOverride: number;
};

export function ModelAdmissionPanel() {
  const t = useTranslations("pages.admin.models");
  const [threshold, setThreshold] = useState<Threshold | null>(null);
  const [scorecards, setScorecards] = useState<Record<string, { latest: ScorecardEntry }>>({});
  const [overrides, setOverrides] = useState<OverrideRecord[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [admissionRes, cardsRes] = await Promise.all([
        fetch("/api/admin/security/admission"),
        fetch("/api/admin/security/scorecards"),
      ]);
      if (admissionRes.ok) {
        const json = (await admissionRes.json()) as { threshold: Threshold };
        setThreshold(json.threshold);
      }
      if (cardsRes.ok) {
        const json = (await cardsRes.json()) as {
          scorecards: Record<string, { latest: ScorecardEntry }>;
          overrides: OverrideRecord[];
        };
        setScorecards(json.scorecards ?? {});
        setOverrides(json.overrides ?? []);
      }
    } catch {
      // keep previous state on transient errors
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!threshold) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/security/admission", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(threshold),
      });
      if (!res.ok) {
        toast.error(t("admission.toast.saveFailed"));
        return;
      }
      toast.success(t("admission.toast.saved"));
    } catch {
      toast.error(t("admission.toast.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  if (!threshold) return null;

  const entries = Object.values(scorecards).map((s) => s.latest);

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">{t("admission.title")}</h3>
            <p className="text-xs text-muted-foreground">{t("admission.subtitle")}</p>
          </div>
          <Badge variant={threshold.enabled ? "soft" : "outline"}>
            {threshold.enabled ? t("admission.enabled") : t("admission.disabled")}
          </Badge>
        </div>

        <div className="flex flex-wrap items-end gap-4 rounded-lg border border-border p-3">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={threshold.enabled}
              onCheckedChange={(v) => setThreshold({ ...threshold, enabled: v === true })}
            />
            {t("admission.gateEnabled")}
          </label>
          <div className="w-40 space-y-1">
            <Label className="text-xs">{t("admission.minScore")}</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={threshold.minScore}
              onChange={(e) => setThreshold({ ...threshold, minScore: Number(e.target.value) })}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={threshold.requireScorecard}
              onCheckedChange={(v) => setThreshold({ ...threshold, requireScorecard: v === true })}
            />
            {t("admission.requireScorecard")}
          </label>
          <Button size="sm" onClick={() => void save()} disabled={saving}>
            {t("admission.save")}
          </Button>
        </div>

        <div className="rounded-lg border border-border">
          <div className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
            {t("admission.scorecardsTitle")}
          </div>
          {entries.length === 0 ? (
            <p className="px-3 py-3 text-xs text-muted-foreground">{t("admission.noScorecards")}</p>
          ) : (
            <ul className="divide-y divide-border">
              {entries.map((s) => (
                <li key={s.model} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{s.model}</div>
                    <div className="truncate text-xs text-muted-foreground font-mono">
                      {s.provider} · {s.runId} · {s.createdAt}
                    </div>
                  </div>
                  <Badge variant={s.safetyScore >= threshold.minScore ? "soft" : "destructive"}>
                    {s.safetyScore} · {s.grade}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>

        {overrides.length > 0 ? (
          <div className="rounded-lg border border-border">
            <div className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
              {t("admission.overridesTitle")}
            </div>
            <ul className="divide-y divide-border">
              {overrides.slice(0, 5).map((o, i) => (
                <li key={`${o.model}-${o.at}-${i}`} className="px-3 py-2 text-xs">
                  <span className="font-medium">{o.model}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {o.at} · {t("admission.overrideScore")}: {o.scoreAtOverride}
                  </span>
                  <div className="text-muted-foreground">{o.reason}</div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
