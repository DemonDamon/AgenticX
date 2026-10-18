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
  updatedAt: string;
};

type CasePage = { id: string; file: string; title: string };

type CaseDetail = CaseRow & { pages: CasePage[] };

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
  const [open, setOpen] = useState<CaseDetail | null>(null);
  const [activeFile, setActiveFile] = useState("");
  const [pageHtml, setPageHtml] = useState("");
  const [pageError, setPageError] = useState("");
  const [pageLoading, setPageLoading] = useState(false);

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

  const loadPage = useCallback(async (caseId: string, file: string) => {
    setPageLoading(true);
    setPageError("");
    setPageHtml("");
    const res = await adminFetch(`/api/admin/cases/${encodeURIComponent(caseId)}/page?file=${encodeURIComponent(file)}`);
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { message?: string };
      setPageError(json.message || t("pageFailed"));
      setPageLoading(false);
      return;
    }
    setPageHtml(await res.text());
    setPageLoading(false);
  }, [t]);

  const openCase = async (id: string) => {
    setError("");
    const res = await adminFetch(`/api/admin/cases/${encodeURIComponent(id)}`, { cache: "no-store" });
    const json = (await res.json()) as { message?: string; data?: { case?: CaseDetail } };
    if (!res.ok || !json.data?.case) {
      setError(json.message || t("openFailed"));
      return;
    }
    const detail = json.data.case;
    setOpen(detail);
    const first = detail.pages[0]?.file ?? "";
    setActiveFile(first);
    if (first) await loadPage(detail.id, first);
    else setPageHtml("");
  };

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
    if (open?.id === id) await openCase(id);
  };

  if (open) {
    const action = NEXT_ACTION[open.status];
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
        <div className="flex items-center justify-between gap-3">
          <Button variant="outline" size="sm" onClick={() => setOpen(null)}>
            {t("back")}
          </Button>
          <div className="flex items-center gap-2">
            {open.status === "reviewing" ? (
              <Button size="sm" variant="outline" onClick={() => void move(open.id, "submitted")}>
                {t("return")}
              </Button>
            ) : null}
            {action ? (
              <Button size="sm" onClick={() => void move(open.id, action.status)}>
                {t(action.labelKey)}
              </Button>
            ) : null}
          </div>
        </div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-foreground">{open.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{open.summary || t("noSummary")}</p>
            {open.sourceRepo ? (
              <p className="mt-1 truncate text-xs text-muted-foreground">{open.sourceRepo}</p>
            ) : null}
          </div>
          <Badge variant="secondary">{t(`status.${open.status}`)}</Badge>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {open.pages.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noPages")}</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {open.pages.map((page) => (
                <Button
                  key={page.file}
                  size="sm"
                  variant={page.file === activeFile ? "default" : "outline"}
                  onClick={() => {
                    setActiveFile(page.file);
                    void loadPage(open.id, page.file);
                  }}
                >
                  {page.title}
                </Button>
              ))}
            </div>
            <div className="h-[72vh] overflow-auto rounded-xl border border-border bg-white">
              {pageLoading ? <p className="p-6 text-sm text-muted-foreground">{t("pageLoading")}</p> : null}
              {pageError ? <p className="p-6 text-sm text-destructive">{pageError}</p> : null}
              {pageHtml ? (
                <iframe
                  title={open.pages.find((page) => page.file === activeFile)?.title ?? open.title}
                  sandbox="allow-scripts allow-popups"
                  srcDoc={pageHtml}
                  className="h-[900px] w-[1440px] max-w-none bg-white"
                />
              ) : null}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
      <PageHeader title={t("title")} description={t("description")} />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {loading ? <p className="text-sm text-muted-foreground">{t("loading")}</p> : null}
      {!loading && cases.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}
      <div className="flex flex-col gap-3">
        {cases.map((item) => (
          <button
            key={item.id}
            type="button"
            className="rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-accent"
            onClick={() => void openCase(item.id)}
          >
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
            <p className="mt-3 text-xs font-medium text-primary">{t("open")}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
