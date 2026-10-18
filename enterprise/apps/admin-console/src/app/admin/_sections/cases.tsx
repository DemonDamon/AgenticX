"use client";

import { adminFetch } from "../../../lib/admin-client-auth";
import { Badge, Button, PageHeader } from "@agenticx/ui";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type CaseStatus = "submitted" | "reviewing" | "archived" | "published";

type CaseRow = {
  id: string;
  title: string;
  summary: string;
  sourceRepo: string;
  status: CaseStatus;
  submitterUserId: string;
  updatedAt: string;
};

const NEXT_ACTION: Record<CaseStatus, { status: CaseStatus; labelKey: string } | null> = {
  submitted: { status: "reviewing", labelKey: "startReview" },
  reviewing: { status: "archived", labelKey: "archive" },
  archived: { status: "published", labelKey: "publish" },
  published: null,
};

export default function CasesSection() {
  const t = useTranslations("pages.admin.cases");
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const res = await adminFetch("/api/admin/cases", { cache: "no-store" });
    const json = (await res.json()) as { message?: string; data?: { cases?: CaseRow[] } };
    if (!res.ok) {
      setError(json.message || t("loadFailed"));
      setCases([]);
    } else {
      setCases(json.data?.cases ?? []);
    }
    setLoading(false);
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const move = async (id: string, status: CaseStatus) => {
    setError("");
    const res = await adminFetch(`/api/admin/cases/${encodeURIComponent(id)}/transition`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const json = (await res.json()) as { message?: string };
    if (!res.ok) {
      setError(json.message || t("transitionFailed"));
      return;
    }
    await load();
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
      <PageHeader title={t("title")} description={t("description")} />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {loading ? <p className="text-sm text-muted-foreground">{t("loading")}</p> : null}
      {!loading && cases.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}
      <div className="flex flex-col gap-3">
        {cases.map((item) => {
          const action = NEXT_ACTION[item.status];
          return (
            <article key={item.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-medium text-foreground">{item.title}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{item.summary || t("noSummary")}</p>
                  {item.sourceRepo ? (
                    <p className="mt-1 truncate text-xs text-muted-foreground">{item.sourceRepo}</p>
                  ) : null}
                </div>
                <Badge variant="secondary">{t(`status.${item.status}`)}</Badge>
              </div>
              <div className="mt-3 flex items-center gap-2">
                {item.status === "reviewing" ? (
                  <Button size="sm" variant="outline" onClick={() => void move(item.id, "submitted")}>
                    {t("return")}
                  </Button>
                ) : null}
                {action ? (
                  <Button size="sm" onClick={() => void move(item.id, action.status)}>
                    {t(action.labelKey)}
                  </Button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
