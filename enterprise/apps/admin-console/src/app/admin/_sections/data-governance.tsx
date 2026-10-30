"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  PageHeader,
  toast,
} from "@agenticx/ui";
import { useTranslations } from "next-intl";
import { adminFetch } from "../../../lib/admin-client-auth";
import {
  SAMPLE_CLASSIFICATION_GRADES,
  SAMPLE_CLEANING_RULES,
  SAMPLE_DICTIONARY_FIELDS,
  SAMPLE_QUALITY_METRICS,
  type ClassificationGrade,
  type CleaningRule,
  type DictionaryField,
  type QualityLastRun,
  type QualityMetric,
  type ReviewAction,
} from "../../../lib/data-suite-types";

type TabId = "dictionary" | "cleaning" | "classification" | "quality" | "review";

const EMPTY_FORM: DictionaryField = {
  name: "",
  business_def: "",
  calc_logic: "",
  update_freq: "daily",
  owner: "data-platform",
};

const EMPTY_RULE: CleaningRule = {
  id: "",
  template: "not_null",
  field: "",
  params: {},
  enabled: true,
};

const EMPTY_GRADE: ClassificationGrade = { id: "", label: "", rank: 1 };
const EMPTY_METRIC: QualityMetric = { id: "", type: "null_rate", field: "" };
const EMPTY_REVIEW: Omit<ReviewAction, "at"> & { at?: string } = {
  id: "",
  target_rule_id: "",
  decision: "approve",
  note: "",
};

const TABS: TabId[] = ["dictionary", "cleaning", "classification", "quality", "review"];

export default function AdminDataGovernanceSection() {
  const t = useTranslations("pages.admin.dataGovernance");
  const [tab, setTab] = useState<TabId>("dictionary");

  // Dictionary
  const [fields, setFields] = useState<DictionaryField[]>([...SAMPLE_DICTIONARY_FIELDS]);
  const [fromApi, setFromApi] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<DictionaryField>(EMPTY_FORM);

  // Cleaning
  const [rules, setRules] = useState<CleaningRule[]>([...SAMPLE_CLEANING_RULES]);
  const [ruleForm, setRuleForm] = useState<CleaningRule>(EMPTY_RULE);
  const [savingRule, setSavingRule] = useState(false);

  // Classification
  const [grades, setGrades] = useState<ClassificationGrade[]>([...SAMPLE_CLASSIFICATION_GRADES]);
  const [gradeForm, setGradeForm] = useState<ClassificationGrade>(EMPTY_GRADE);
  const [savingGrade, setSavingGrade] = useState(false);

  // Quality
  const [metrics, setMetrics] = useState<QualityMetric[]>([...SAMPLE_QUALITY_METRICS]);
  const [lastRun, setLastRun] = useState<QualityLastRun | null>(null);
  const [metricForm, setMetricForm] = useState<QualityMetric>(EMPTY_METRIC);
  const [savingMetric, setSavingMetric] = useState(false);
  const [runningQuality, setRunningQuality] = useState(false);

  // Review
  const [actions, setActions] = useState<ReviewAction[]>([]);
  const [reviewForm, setReviewForm] = useState(EMPTY_REVIEW);
  const [savingReview, setSavingReview] = useState(false);

  const loadDictionary = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch("/api/admin/data-suite/dictionary");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { data?: { fields?: DictionaryField[] } };
      const next = json.data?.fields ?? [];
      setFields(next.length ? next : [...SAMPLE_DICTIONARY_FIELDS]);
      setFromApi(true);
      setLoadError(false);
    } catch {
      setFields([...SAMPLE_DICTIONARY_FIELDS]);
      setFromApi(false);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCleaning = useCallback(async () => {
    try {
      const res = await adminFetch("/api/admin/data-suite/cleaning-rules");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { data?: { rules?: CleaningRule[] } };
      setRules(json.data?.rules?.length ? json.data.rules : [...SAMPLE_CLEANING_RULES]);
    } catch {
      setRules([...SAMPLE_CLEANING_RULES]);
    }
  }, []);

  const loadClassification = useCallback(async () => {
    try {
      const res = await adminFetch("/api/admin/data-suite/classification");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { data?: { grades?: ClassificationGrade[] } };
      setGrades(json.data?.grades?.length ? json.data.grades : [...SAMPLE_CLASSIFICATION_GRADES]);
    } catch {
      setGrades([...SAMPLE_CLASSIFICATION_GRADES]);
    }
  }, []);

  const loadQuality = useCallback(async () => {
    try {
      const res = await adminFetch("/api/admin/data-suite/quality-metrics");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        data?: { metrics?: QualityMetric[]; last_run?: QualityLastRun | null };
      };
      setMetrics(json.data?.metrics?.length ? json.data.metrics : [...SAMPLE_QUALITY_METRICS]);
      setLastRun(json.data?.last_run ?? null);
    } catch {
      setMetrics([...SAMPLE_QUALITY_METRICS]);
      setLastRun(null);
    }
  }, []);

  const loadReview = useCallback(async () => {
    try {
      const res = await adminFetch("/api/admin/data-suite/review-actions");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { data?: { actions?: ReviewAction[] } };
      setActions(json.data?.actions ?? []);
    } catch {
      setActions([]);
    }
  }, []);

  useEffect(() => {
    void loadDictionary();
    void loadCleaning();
    void loadClassification();
    void loadQuality();
    void loadReview();
  }, [loadDictionary, loadCleaning, loadClassification, loadQuality, loadReview]);

  async function saveField() {
    if (!form.name.trim()) {
      toast.error(t("formName"));
      return;
    }
    setSaving(true);
    try {
      const res = await adminFetch("/api/admin/data-suite/dictionary", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(t("saveSuccess"));
      setForm(EMPTY_FORM);
      await loadDictionary();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function saveRule() {
    if (!ruleForm.id.trim()) {
      toast.error(t("formId"));
      return;
    }
    setSavingRule(true);
    try {
      const res = await adminFetch("/api/admin/data-suite/cleaning-rules", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(ruleForm),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(t("cleaningSaveSuccess"));
      setRuleForm(EMPTY_RULE);
      await loadCleaning();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setSavingRule(false);
    }
  }

  async function saveGrade() {
    if (!gradeForm.id.trim()) {
      toast.error(t("formId"));
      return;
    }
    setSavingGrade(true);
    try {
      const res = await adminFetch("/api/admin/data-suite/classification", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(gradeForm),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(t("classificationSaveSuccess"));
      setGradeForm(EMPTY_GRADE);
      await loadClassification();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setSavingGrade(false);
    }
  }

  async function saveMetric() {
    if (!metricForm.id.trim()) {
      toast.error(t("formId"));
      return;
    }
    setSavingMetric(true);
    try {
      const res = await adminFetch("/api/admin/data-suite/quality-metrics", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(metricForm),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(t("qualitySaveSuccess"));
      setMetricForm(EMPTY_METRIC);
      await loadQuality();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setSavingMetric(false);
    }
  }

  async function runQuality() {
    setRunningQuality(true);
    try {
      const day = new Date().toISOString().slice(0, 10);
      const res = await adminFetch("/api/admin/data-suite/quality-metrics/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ day }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(t("qualityRunSuccess"));
      await loadQuality();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setRunningQuality(false);
    }
  }

  async function saveReview() {
    if (!reviewForm.id.trim()) {
      toast.error(t("formId"));
      return;
    }
    setSavingReview(true);
    try {
      const res = await adminFetch("/api/admin/data-suite/review-actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...reviewForm,
          at: reviewForm.at || new Date().toISOString(),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(t("reviewSaveSuccess"));
      setReviewForm(EMPTY_REVIEW);
      await loadReview();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setSavingReview(false);
    }
  }

  return (
    <div className="space-y-6" data-testid="data-governance-page">
      <PageHeader title={t("title")} description={t("description")} />

      <div className="flex flex-wrap gap-2" data-testid="data-governance-tabs" role="tablist">
        {TABS.map((id) => (
          <Button
            key={id}
            type="button"
            variant={tab === id ? "default" : "outline"}
            size="sm"
            role="tab"
            aria-selected={tab === id}
            data-testid={`data-governance-tab-${id}`}
            onClick={() => setTab(id)}
          >
            {t(`tabs.${id}`)}
          </Button>
        ))}
      </div>

      {tab === "dictionary" ? (
        <>
          <Card data-testid="data-governance-dictionary">
            <CardHeader>
              <CardTitle>{t("dictionaryTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <p className="text-sm text-muted-foreground">{t("loading")}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="data-governance-fields">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-2 pr-4 font-medium">{t("col.name")}</th>
                        <th className="py-2 pr-4 font-medium">{t("col.owner")}</th>
                        <th className="py-2 pr-4 font-medium">{t("col.updateFreq")}</th>
                        <th className="py-2 font-medium">{t("col.businessDef")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fields.map((f) => (
                        <tr
                          key={f.name}
                          className="border-b last:border-0 cursor-pointer hover:bg-muted/40"
                          data-testid={`data-governance-field-${f.name}`}
                          onClick={() => setForm({ ...f })}
                        >
                          <td className="py-2 pr-4 font-mono text-xs">{f.name}</td>
                          <td className="py-2 pr-4">{f.owner}</td>
                          <td className="py-2 pr-4">{f.update_freq}</td>
                          <td className="py-2">{f.business_def}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {fromApi ? (
                <p className="mt-4 text-xs text-muted-foreground" data-testid="data-governance-api-source">
                  {t("apiSource")}
                </p>
              ) : null}
              {loadError ? (
                <p className="mt-4 text-xs text-muted-foreground" data-testid="data-governance-stub">
                  {t("stubNote")}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card data-testid="data-governance-upsert">
            <CardHeader>
              <CardTitle>{t("formTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="dict-name">{t("formName")}</Label>
                <Input
                  id="dict-name"
                  data-testid="data-governance-form-name"
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dict-owner">{t("formOwner")}</Label>
                <Input
                  id="dict-owner"
                  data-testid="data-governance-form-owner"
                  value={form.owner}
                  onChange={(e) => setForm((prev) => ({ ...prev, owner: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dict-freq">{t("formUpdateFreq")}</Label>
                <Input
                  id="dict-freq"
                  data-testid="data-governance-form-update-freq"
                  value={form.update_freq}
                  onChange={(e) => setForm((prev) => ({ ...prev, update_freq: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dict-calc">{t("formCalcLogic")}</Label>
                <Input
                  id="dict-calc"
                  data-testid="data-governance-form-calc-logic"
                  value={form.calc_logic}
                  onChange={(e) => setForm((prev) => ({ ...prev, calc_logic: e.target.value }))}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="dict-def">{t("formBusinessDef")}</Label>
                <Input
                  id="dict-def"
                  data-testid="data-governance-form-business-def"
                  value={form.business_def}
                  onChange={(e) => setForm((prev) => ({ ...prev, business_def: e.target.value }))}
                />
              </div>
              <div className="sm:col-span-2">
                <Button
                  data-testid="data-governance-form-save"
                  onClick={() => void saveField()}
                  disabled={saving || !form.name.trim()}
                >
                  {saving ? t("saving") : t("save")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}

      {tab === "cleaning" ? (
        <>
          <Card data-testid="data-governance-cleaning">
            <CardHeader>
              <CardTitle>{t("cleaningTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="data-governance-cleaning-rules">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">{t("colId")}</th>
                      <th className="py-2 pr-4 font-medium">{t("colTemplate")}</th>
                      <th className="py-2 pr-4 font-medium">{t("colField")}</th>
                      <th className="py-2 font-medium">{t("colEnabled")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rules.map((r) => (
                      <tr
                        key={r.id}
                        className="border-b last:border-0 cursor-pointer hover:bg-muted/40"
                        data-testid={`data-governance-cleaning-rule-${r.id}`}
                        onClick={() => setRuleForm({ ...r, params: { ...r.params } })}
                      >
                        <td className="py-2 pr-4 font-mono text-xs">{r.id}</td>
                        <td className="py-2 pr-4">{r.template}</td>
                        <td className="py-2 pr-4">{r.field}</td>
                        <td className="py-2">{r.enabled ? "yes" : "no"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
          <Card data-testid="data-governance-cleaning-upsert">
            <CardHeader>
              <CardTitle>{t("cleaningFormTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t("formId")}</Label>
                <Input
                  data-testid="data-governance-cleaning-form-id"
                  value={ruleForm.id}
                  onChange={(e) => setRuleForm((p) => ({ ...p, id: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("formTemplate")}</Label>
                <Input
                  data-testid="data-governance-cleaning-form-template"
                  value={ruleForm.template}
                  onChange={(e) => setRuleForm((p) => ({ ...p, template: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("formField")}</Label>
                <Input
                  data-testid="data-governance-cleaning-form-field"
                  value={ruleForm.field}
                  onChange={(e) => setRuleForm((p) => ({ ...p, field: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("formEnabled")}</Label>
                <Input
                  data-testid="data-governance-cleaning-form-enabled"
                  value={ruleForm.enabled ? "true" : "false"}
                  onChange={(e) =>
                    setRuleForm((p) => ({
                      ...p,
                      enabled: e.target.value.trim().toLowerCase() !== "false",
                    }))
                  }
                />
              </div>
              <div className="sm:col-span-2">
                <Button
                  data-testid="data-governance-cleaning-form-save"
                  onClick={() => void saveRule()}
                  disabled={savingRule || !ruleForm.id.trim()}
                >
                  {savingRule ? t("saving") : t("cleaningSave")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}

      {tab === "classification" ? (
        <>
          <Card data-testid="data-governance-classification">
            <CardHeader>
              <CardTitle>{t("classificationTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="data-governance-grades">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">{t("colId")}</th>
                      <th className="py-2 pr-4 font-medium">{t("colLabel")}</th>
                      <th className="py-2 font-medium">{t("colRank")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grades.map((g) => (
                      <tr
                        key={g.id}
                        className="border-b last:border-0 cursor-pointer hover:bg-muted/40"
                        data-testid={`data-governance-grade-${g.id}`}
                        onClick={() => setGradeForm({ ...g })}
                      >
                        <td className="py-2 pr-4 font-mono text-xs">{g.id}</td>
                        <td className="py-2 pr-4">{g.label}</td>
                        <td className="py-2">{g.rank}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
          <Card data-testid="data-governance-classification-upsert">
            <CardHeader>
              <CardTitle>{t("classificationFormTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>{t("formId")}</Label>
                <Input
                  data-testid="data-governance-grade-form-id"
                  value={gradeForm.id}
                  onChange={(e) => setGradeForm((p) => ({ ...p, id: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("formLabel")}</Label>
                <Input
                  data-testid="data-governance-grade-form-label"
                  value={gradeForm.label}
                  onChange={(e) => setGradeForm((p) => ({ ...p, label: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("formRank")}</Label>
                <Input
                  data-testid="data-governance-grade-form-rank"
                  type="number"
                  value={String(gradeForm.rank)}
                  onChange={(e) => setGradeForm((p) => ({ ...p, rank: Number(e.target.value) || 0 }))}
                />
              </div>
              <div className="sm:col-span-3">
                <Button
                  data-testid="data-governance-grade-form-save"
                  onClick={() => void saveGrade()}
                  disabled={savingGrade || !gradeForm.id.trim()}
                >
                  {savingGrade ? t("saving") : t("classificationSave")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}

      {tab === "quality" ? (
        <>
          <Card data-testid="data-governance-quality">
            <CardHeader>
              <CardTitle>{t("qualityTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="data-governance-quality-metrics">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">{t("colId")}</th>
                      <th className="py-2 pr-4 font-medium">{t("colType")}</th>
                      <th className="py-2 font-medium">{t("colField")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.map((m) => (
                      <tr
                        key={m.id}
                        className="border-b last:border-0 cursor-pointer hover:bg-muted/40"
                        data-testid={`data-governance-quality-metric-${m.id}`}
                        onClick={() => setMetricForm({ ...m })}
                      >
                        <td className="py-2 pr-4 font-mono text-xs">{m.id}</td>
                        <td className="py-2 pr-4">{m.type}</td>
                        <td className="py-2">{m.field}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {lastRun ? (
                <pre
                  className="rounded-md bg-muted/40 p-3 text-xs overflow-x-auto"
                  data-testid="data-governance-quality-last-run"
                >
                  {t("qualityLastRun")}: {JSON.stringify(lastRun, null, 2)}
                </pre>
              ) : (
                <p className="text-xs text-muted-foreground" data-testid="data-governance-quality-last-run-empty">
                  {t("qualityLastRun")}: —
                </p>
              )}
              <Button
                data-testid="data-governance-quality-run"
                variant="secondary"
                onClick={() => void runQuality()}
                disabled={runningQuality}
              >
                {runningQuality ? t("saving") : t("qualityRun")}
              </Button>
            </CardContent>
          </Card>
          <Card data-testid="data-governance-quality-upsert">
            <CardHeader>
              <CardTitle>{t("qualityFormTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>{t("formId")}</Label>
                <Input
                  data-testid="data-governance-quality-form-id"
                  value={metricForm.id}
                  onChange={(e) => setMetricForm((p) => ({ ...p, id: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("formType")}</Label>
                <Input
                  data-testid="data-governance-quality-form-type"
                  value={metricForm.type}
                  onChange={(e) => setMetricForm((p) => ({ ...p, type: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("formField")}</Label>
                <Input
                  data-testid="data-governance-quality-form-field"
                  value={metricForm.field}
                  onChange={(e) => setMetricForm((p) => ({ ...p, field: e.target.value }))}
                />
              </div>
              <div className="sm:col-span-3">
                <Button
                  data-testid="data-governance-quality-form-save"
                  onClick={() => void saveMetric()}
                  disabled={savingMetric || !metricForm.id.trim()}
                >
                  {savingMetric ? t("saving") : t("qualitySave")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}

      {tab === "review" ? (
        <>
          <Card data-testid="data-governance-review">
            <CardHeader>
              <CardTitle>{t("reviewTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="data-governance-review-actions">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">{t("colId")}</th>
                      <th className="py-2 pr-4 font-medium">{t("colTarget")}</th>
                      <th className="py-2 pr-4 font-medium">{t("colDecision")}</th>
                      <th className="py-2 pr-4 font-medium">{t("colNote")}</th>
                      <th className="py-2 font-medium">{t("colAt")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {actions.map((a) => (
                      <tr
                        key={a.id}
                        className="border-b last:border-0"
                        data-testid={`data-governance-review-action-${a.id}`}
                      >
                        <td className="py-2 pr-4 font-mono text-xs">{a.id}</td>
                        <td className="py-2 pr-4">{a.target_rule_id}</td>
                        <td className="py-2 pr-4">{a.decision}</td>
                        <td className="py-2 pr-4">{a.note}</td>
                        <td className="py-2 text-xs">{a.at}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
          <Card data-testid="data-governance-review-upsert">
            <CardHeader>
              <CardTitle>{t("reviewFormTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t("formId")}</Label>
                <Input
                  data-testid="data-governance-review-form-id"
                  value={reviewForm.id}
                  onChange={(e) => setReviewForm((p) => ({ ...p, id: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("formTarget")}</Label>
                <Input
                  data-testid="data-governance-review-form-target"
                  value={reviewForm.target_rule_id}
                  onChange={(e) => setReviewForm((p) => ({ ...p, target_rule_id: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("formDecision")}</Label>
                <Input
                  data-testid="data-governance-review-form-decision"
                  value={reviewForm.decision}
                  onChange={(e) =>
                    setReviewForm((p) => ({
                      ...p,
                      decision: e.target.value as ReviewAction["decision"],
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>{t("formNote")}</Label>
                <Input
                  data-testid="data-governance-review-form-note"
                  value={reviewForm.note}
                  onChange={(e) => setReviewForm((p) => ({ ...p, note: e.target.value }))}
                />
              </div>
              <div className="sm:col-span-2">
                <Button
                  data-testid="data-governance-review-form-save"
                  onClick={() => void saveReview()}
                  disabled={savingReview || !reviewForm.id.trim()}
                >
                  {savingReview ? t("saving") : t("reviewSave")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
