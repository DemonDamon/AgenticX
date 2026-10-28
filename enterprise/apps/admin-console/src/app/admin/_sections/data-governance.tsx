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
  SAMPLE_DICTIONARY_FIELDS,
  type DictionaryField,
} from "../../../lib/data-suite-types";

const EMPTY_FORM: DictionaryField = {
  name: "",
  business_def: "",
  calc_logic: "",
  update_freq: "daily",
  owner: "data-platform",
};

export default function AdminDataGovernanceSection() {
  const t = useTranslations("pages.admin.dataGovernance");
  const [fields, setFields] = useState<DictionaryField[]>([...SAMPLE_DICTIONARY_FIELDS]);
  const [fromApi, setFromApi] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<DictionaryField>(EMPTY_FORM);

  const load = useCallback(async () => {
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

  useEffect(() => {
    void load();
  }, [load]);

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
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  function editField(field: DictionaryField) {
    setForm({ ...field });
  }

  return (
    <div className="space-y-6" data-testid="data-governance-page">
      <PageHeader title={t("title")} description={t("description")} />
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
                      onClick={() => editField(f)}
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
    </div>
  );
}
