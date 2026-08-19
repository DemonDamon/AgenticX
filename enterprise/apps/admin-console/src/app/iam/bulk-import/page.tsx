"use client";

import { PageHeader } from "@agenticx/ui";
import { useTranslations } from "next-intl";

import { BulkImportWizard } from "../../../components/BulkImportWizard";
import { OrganizationEditor } from "../../../components/OrganizationEditor";

/**
 * 组织结构与批量导入。
 *
 * 不在导航里：编组织树和导花名册都是「新环境搭起来那几天」的事，之后几乎不再点。
 * 导入向导同时挂在成员列表的工具栏上，日常要补人从那儿进。
 */
export default function BulkImportPage() {
  const t = useTranslations("pages.iam.bulkImport");

  return (
    <div className="space-y-5 p-6">
      <PageHeader title={t("organizationTitle")} description={t("organizationDescription")} />
      <OrganizationEditor />
      <div className="pt-2">
        <h2 className="text-lg font-semibold tracking-tight">{t("bulkProvisioningTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("bulkProvisioningDescription")}</p>
      </div>
      <BulkImportWizard />
    </div>
  );
}
