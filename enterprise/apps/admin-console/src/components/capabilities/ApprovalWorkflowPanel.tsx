"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  toast,
} from "@agenticx/ui";
import { ClipboardCheck, RefreshCcw } from "lucide-react";
import { useTranslations } from "next-intl";

type Preset = { slug: string; displayNameZh: string };
type ApprovalStep = {
  stepOrder: number;
  stepKind: string;
  actorScope: string | null;
  status: string;
  decisionNote: string | null;
};
type ApprovalItem = {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string;
  status: string;
  rejectionReason: string | null;
  presetSlug: string;
  steps: ApprovalStep[];
};

const PRESET_NONE = "__none__";

export function ApprovalWorkflowPanel() {
  const t = useTranslations("pages.admin.capabilityPacks.approval");
  const tc = useTranslations("common");
  const [presets, setPresets] = useState<Preset[]>([]);
  const [skillPreset, setSkillPreset] = useState<string>(PRESET_NONE);
  const [introducePreset, setIntroducePreset] = useState<string>(PRESET_NONE);
  const [catalogPreset, setCatalogPreset] = useState<string>(PRESET_NONE);
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [presetRes, settingsRes, platformRes, listRes] = await Promise.all([
        fetch("/api/admin/ecp/approval-presets"),
        fetch("/api/admin/ecp/approval-settings"),
        fetch("/api/admin/ecp/platform-approval-settings"),
        fetch("/api/admin/approval-requests?status=pending"),
      ]);
      const presetBody = (await presetRes.json()) as { data?: { presets: Preset[] } };
      const settingsBody = (await settingsRes.json()) as {
        data?: {
          settings: { skillPublishPresetSlug: string | null; platformIntroducePresetSlug: string | null };
        };
      };
      const platformBody = (await platformRes.json()) as {
        data?: { settings: { catalogPublishPresetSlug: string | null } };
      };
      const listBody = (await listRes.json()) as { data?: { items: ApprovalItem[] } };
      setPresets(presetBody.data?.presets ?? []);
      setSkillPreset(settingsBody.data?.settings.skillPublishPresetSlug ?? PRESET_NONE);
      setIntroducePreset(settingsBody.data?.settings.platformIntroducePresetSlug ?? PRESET_NONE);
      setCatalogPreset(platformBody.data?.settings.catalogPublishPresetSlug ?? PRESET_NONE);
      setItems(listBody.data?.items ?? []);
    } catch {
      toast.error(t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveSettings() {
    const skillPublishPresetSlug = skillPreset === PRESET_NONE ? null : skillPreset;
    const platformIntroducePresetSlug = introducePreset === PRESET_NONE ? null : introducePreset;
    const catalogPublishPresetSlug = catalogPreset === PRESET_NONE ? null : catalogPreset;
    const [tenantRes, platformRes] = await Promise.all([
      fetch("/api/admin/ecp/approval-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillPublishPresetSlug, platformIntroducePresetSlug }),
      }),
      fetch("/api/admin/ecp/platform-approval-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ catalogPublishPresetSlug }),
      }),
    ]);
    if (!tenantRes.ok || !platformRes.ok) {
      toast.error(t("saveFailed"));
      return;
    }
    toast.success(t("saved"));
  }

  async function approve(id: string) {
    const res = await fetch(`/api/admin/approval-requests/${id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      toast.error(t("actionFailed"));
      return;
    }
    toast.success(t("approved"));
    void load();
  }

  async function reject(id: string) {
    const reason = rejectReason[id]?.trim();
    if (!reason) {
      toast.error(t("reasonRequired"));
      return;
    }
    const res = await fetch(`/api/admin/approval-requests/${id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) {
      toast.error(t("actionFailed"));
      return;
    }
    toast.success(t("rejected"));
    void load();
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardCheck className="size-4" /> {t("settingsTitle")}
          </CardTitle>
          <CardDescription>{t("settingsDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>{t("skillPublishPreset")}</Label>
            <Select value={skillPreset} onValueChange={setSkillPreset}>
              <SelectTrigger>
                <SelectValue placeholder={t("presetDisabled")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={PRESET_NONE}>{t("presetDisabled")}</SelectItem>
                {presets.map((p) => (
                  <SelectItem key={p.slug} value={p.slug}>
                    {p.displayNameZh}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("platformIntroducePreset")}</Label>
            <Select value={introducePreset} onValueChange={setIntroducePreset}>
              <SelectTrigger>
                <SelectValue placeholder={t("presetDisabled")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={PRESET_NONE}>{t("presetDisabled")}</SelectItem>
                {presets.map((p) => (
                  <SelectItem key={p.slug} value={p.slug}>
                    {p.displayNameZh}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("catalogPublishPreset")}</Label>
            <Select value={catalogPreset} onValueChange={setCatalogPreset}>
              <SelectTrigger>
                <SelectValue placeholder={t("presetDisabled")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={PRESET_NONE}>{t("presetDisabled")}</SelectItem>
                {presets.map((p) => (
                  <SelectItem key={p.slug} value={p.slug}>
                    {p.displayNameZh}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-3 flex gap-2">
            <Button onClick={() => void saveSettings()}>{tc("actions.save")}</Button>
            <Button variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCcw className="mr-1 size-4" /> {tc("actions.refresh")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("queueTitle")}</CardTitle>
          <CardDescription>{t("queueDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading && <p className="text-sm text-muted-foreground">{tc("states.loading")}</p>}
          {!loading && items.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("queueEmpty")}</p>
          )}
          {items.map((item) => (
            <div key={item.id} className="rounded-lg border p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{t(`action.${item.action}`)}</Badge>
                <Badge>{t(`status.${item.status}`)}</Badge>
                <span className="text-xs text-muted-foreground">
                  {item.resourceType} · {item.resourceId}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {item.steps.map((step) => (
                  <Badge
                    key={step.stepOrder}
                    variant={step.status === "failed" ? "destructive" : step.status === "passed" ? "success" : "outline"}
                  >
                    {step.stepKind === "auto_scan"
                      ? t("stepScan")
                      : t(`actor.${step.actorScope ?? "unknown"}`)}{" "}
                    · {t(`stepStatus.${step.status}`)}
                  </Badge>
                ))}
              </div>
              {item.rejectionReason ? (
                <p className="text-xs text-destructive">{t("rejectReason")}: {item.rejectionReason}</p>
              ) : null}
              {item.status === "pending" ? (
                <div className="flex flex-wrap items-end gap-2">
                  <Textarea
                    className="min-h-16 max-w-md"
                    placeholder={t("rejectPlaceholder")}
                    value={rejectReason[item.id] ?? ""}
                    onChange={(e) =>
                      setRejectReason((prev) => ({ ...prev, [item.id]: e.target.value }))
                    }
                  />
                  <Button size="sm" onClick={() => void approve(item.id)}>
                    {t("approve")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void reject(item.id)}>
                    {t("reject")}
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
