"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button, PageHeader } from "@agenticx/ui";
import { RefreshCcw } from "lucide-react";

const ManagedSessionsPanel = dynamic(
  () => import("../../../../components/managed-sessions/ManagedSessionsPanel"),
  { ssr: false },
);

export default function ManagedSessionsPage() {
  const t = useTranslations("shell");
  const tc = useTranslations("common");
  const [reloadToken, setReloadToken] = useState(0);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("nav.items.agentSessions")}
        actions={
          <Button type="button" size="sm" variant="outline" onClick={() => setReloadToken((current) => current + 1)}>
            <RefreshCcw />
            {tc("actions.refresh")}
          </Button>
        }
      />
      <ManagedSessionsPanel reloadToken={reloadToken} />
    </div>
  );
}
