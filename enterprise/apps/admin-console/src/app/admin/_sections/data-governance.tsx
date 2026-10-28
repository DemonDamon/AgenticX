"use client";

import { Card, CardContent, CardHeader, CardTitle, PageHeader } from "@agenticx/ui";
import { useTranslations } from "next-intl";

/** Stub sample — mirrors tests/data_suite/fixtures/sample_dictionary.yaml until API lands. */
const SAMPLE_FIELDS = [
  {
    name: "member_id",
    business_def: "Stable member primary key after OneID merge",
    calc_logic: "idmapping.merge primary",
    update_freq: "daily",
    owner: "data-platform",
  },
  {
    name: "mobile_hash",
    business_def: "Hashed mobile used as ID edge",
    calc_logic: "sha256(mobile_e164)",
    update_freq: "daily",
    owner: "data-platform",
  },
] as const;

export default function AdminDataGovernanceSection() {
  const t = useTranslations("pages.admin.dataGovernance");

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      <Card>
        <CardHeader>
          <CardTitle>{t("dictionaryTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">{t("col.name")}</th>
                  <th className="py-2 pr-4 font-medium">{t("col.owner")}</th>
                  <th className="py-2 pr-4 font-medium">{t("col.updateFreq")}</th>
                  <th className="py-2 font-medium">{t("col.businessDef")}</th>
                </tr>
              </thead>
              <tbody>
                {SAMPLE_FIELDS.map((f) => (
                  <tr key={f.name} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-mono text-xs">{f.name}</td>
                    <td className="py-2 pr-4">{f.owner}</td>
                    <td className="py-2 pr-4">{f.update_freq}</td>
                    <td className="py-2">{f.business_def}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">{t("stubNote")}</p>
        </CardContent>
      </Card>
    </div>
  );
}
