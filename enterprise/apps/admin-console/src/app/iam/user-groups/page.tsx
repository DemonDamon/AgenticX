"use client";

import { PageHeader } from "@agenticx/ui";
import { useTranslations } from "next-intl";

import { UserGroupsPanel } from "../../../components/iam/UserGroupsPanel";

export default function AdminUserGroupsPage() {
  const t = useTranslations("pages.iam.userGroups");

  return (
    <div className="space-y-6 p-6">
      <PageHeader title={t("title")} description={t("description")} />
      <UserGroupsPanel />
    </div>
  );
}
