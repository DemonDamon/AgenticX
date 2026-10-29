"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageHeader,
  toast,
} from "@agenticx/ui";
import { useTranslations } from "next-intl";
import { adminFetch } from "../../../lib/admin-client-auth";
import {
  ALLOWED_OBJECT_TRANSITIONS,
  SAMPLE_KNOWLEDGE_OBJECTS,
  type ChangeEventRow,
  type KnowledgeIssueRow,
  type KnowledgeObjectRow,
  type KnowledgeStatus,
} from "../../../lib/knowledge-lifecycle-types";

export default function AdminKnowledgeLifecycleSection() {
  const t = useTranslations("pages.admin.knowledgeLifecycle");
  const [objects, setObjects] = useState<KnowledgeObjectRow[]>([...SAMPLE_KNOWLEDGE_OBJECTS]);
  const [selectedId, setSelectedId] = useState<string>(SAMPLE_KNOWLEDGE_OBJECTS[0]?.id ?? "");
  const [detail, setDetail] = useState<KnowledgeObjectRow | null>(SAMPLE_KNOWLEDGE_OBJECTS[0] ?? null);
  const [issues, setIssues] = useState<KnowledgeIssueRow[]>([]);
  const [trail, setTrail] = useState<ChangeEventRow[]>([]);
  const [fromApi, setFromApi] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch("/api/admin/knowledge-lifecycle/objects");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { data?: { objects?: KnowledgeObjectRow[] } };
      const next = json.data?.objects ?? [];
      const list = next.length ? next : [...SAMPLE_KNOWLEDGE_OBJECTS];
      setObjects(list);
      setFromApi(Boolean(next.length));
      const prefer = list.find((r) => r.id === selectedId) ?? list[0];
      if (prefer) setSelectedId(prefer.id);
    } catch {
      setObjects([...SAMPLE_KNOWLEDGE_OBJECTS]);
      setFromApi(false);
      setSelectedId(SAMPLE_KNOWLEDGE_OBJECTS[0]?.id ?? "");
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  const loadDetail = useCallback(async (id: string) => {
    if (!id) return;
    try {
      const res = await adminFetch(`/api/admin/knowledge-lifecycle/objects/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        data?: {
          object?: KnowledgeObjectRow;
          issues?: KnowledgeIssueRow[];
          trail?: ChangeEventRow[];
        };
      };
      setDetail(json.data?.object ?? null);
      setIssues(json.data?.issues ?? []);
      setTrail(json.data?.trail ?? []);
      setFromApi(true);
    } catch {
      const fallback = SAMPLE_KNOWLEDGE_OBJECTS.find((r) => r.id === id) ?? null;
      setDetail(fallback);
      setIssues([]);
      setTrail([]);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const nextStatuses = useMemo(() => {
    if (!detail) return [] as KnowledgeStatus[];
    return ALLOWED_OBJECT_TRANSITIONS[detail.status] ?? [];
  }, [detail]);

  async function doTransition(status: KnowledgeStatus) {
    if (!detail) return;
    setBusy(true);
    try {
      const res = await adminFetch(
        `/api/admin/knowledge-lifecycle/objects/${encodeURIComponent(detail.id)}/transition`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status, actor: "admin" }),
        },
      );
      if (!res.ok) throw new Error(await res.text());
      toast.success(t("transitionSuccess"));
      await loadList();
      await loadDetail(detail.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("transitionFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function runQuality() {
    setBusy(true);
    try {
      const res = await adminFetch("/api/admin/knowledge-lifecycle/quality", { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      toast.success(t("qualitySuccess"));
      if (selectedId) await loadDetail(selectedId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("qualityFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function resolveIssue(issueId: string) {
    setBusy(true);
    try {
      const res = await adminFetch(
        `/api/admin/knowledge-lifecycle/issues/${encodeURIComponent(issueId)}/transition`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "resolved", actor: "admin" }),
        },
      );
      if (!res.ok) throw new Error(await res.text());
      toast.success(t("issueResolved"));
      if (selectedId) await loadDetail(selectedId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("issueFailed"));
    } finally {
      setBusy(false);
    }
  }

  const attrName =
    detail && typeof detail.attrs?.name === "string" ? detail.attrs.name : "—";

  return (
    <div className="space-y-6" data-testid="knowledge-lifecycle-page">
      <PageHeader title={t("title")} description={t("description")} />
      <div className="flex flex-wrap gap-2">
        <Button
          data-testid="knowledge-lifecycle-run-quality"
          variant="secondary"
          disabled={busy}
          onClick={() => void runQuality()}
        >
          {t("runQuality")}
        </Button>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card data-testid="knowledge-lifecycle-list">
          <CardHeader>
            <CardTitle>{t("listTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">{t("loading")}</p>
            ) : (
              <table className="w-full text-sm" data-testid="knowledge-lifecycle-table">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-2 pr-2">{t("col.id")}</th>
                    <th className="py-2 pr-2">{t("col.kind")}</th>
                    <th className="py-2 pr-2">{t("col.status")}</th>
                    <th className="py-2">{t("col.version")}</th>
                  </tr>
                </thead>
                <tbody>
                  {objects.map((obj) => (
                    <tr
                      key={obj.id}
                      data-testid={`knowledge-lifecycle-row-${obj.id}`}
                      className={
                        obj.id === selectedId
                          ? "cursor-pointer bg-muted/50"
                          : "cursor-pointer hover:bg-muted/30"
                      }
                      onClick={() => setSelectedId(obj.id)}
                    >
                      <td className="py-2 pr-2 font-mono text-xs">{obj.id}</td>
                      <td className="py-2 pr-2">{obj.kind}</td>
                      <td className="py-2 pr-2">{obj.status}</td>
                      <td className="py-2">v{obj.version}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p
              className="mt-4 text-xs text-muted-foreground"
              data-testid="knowledge-lifecycle-source"
            >
              {fromApi ? t("apiSource") : t("stubNote")}
            </p>
          </CardContent>
        </Card>

        <Card data-testid="knowledge-lifecycle-detail">
          <CardHeader>
            <CardTitle>{t("detailTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {detail ? (
              <>
                <div data-testid="knowledge-lifecycle-detail-id">
                  <span className="text-muted-foreground">{t("col.id")}: </span>
                  <span className="font-mono">{detail.id}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t("col.kind")}: </span>
                  {detail.kind}
                </div>
                <div data-testid="knowledge-lifecycle-detail-status">
                  <span className="text-muted-foreground">{t("col.status")}: </span>
                  {detail.status} (v{detail.version})
                </div>
                <div>
                  <span className="text-muted-foreground">{t("col.name")}: </span>
                  {attrName}
                </div>
                <div className="flex flex-wrap gap-2" data-testid="knowledge-lifecycle-transitions">
                  {nextStatuses.map((status) => (
                    <Button
                      key={status}
                      size="sm"
                      disabled={busy}
                      data-testid={`knowledge-lifecycle-transition-${status}`}
                      onClick={() => void doTransition(status)}
                    >
                      → {status}
                    </Button>
                  ))}
                </div>

                <div>
                  <h3 className="mb-2 font-medium">{t("issuesTitle")}</h3>
                  {issues.length === 0 ? (
                    <p className="text-muted-foreground">{t("noIssues")}</p>
                  ) : (
                    <ul className="space-y-2" data-testid="knowledge-lifecycle-issues">
                      {issues.map((iss) => (
                        <li key={iss.id} className="rounded border p-2 font-mono text-xs">
                          <div>
                            {iss.code} · {iss.status} · {iss.severity}
                          </div>
                          <div className="text-muted-foreground">{iss.message}</div>
                          {(iss.status === "open" || iss.status === "in_progress") && (
                            <Button
                              size="sm"
                              className="mt-2"
                              disabled={busy}
                              data-testid={`knowledge-lifecycle-resolve-${iss.id}`}
                              onClick={() => void resolveIssue(iss.id)}
                            >
                              {t("resolveIssue")}
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <h3 className="mb-2 font-medium">{t("trailTitle")}</h3>
                  {trail.length === 0 ? (
                    <p className="text-muted-foreground">{t("noTrail")}</p>
                  ) : (
                    <ul className="space-y-1" data-testid="knowledge-lifecycle-trail">
                      {trail.map((ev) => (
                        <li key={ev.id} className="font-mono text-xs">
                          {ev.at} · {ev.action} · {ev.from_status ?? "—"}→{ev.to_status ?? "—"} ·{" "}
                          {ev.actor}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            ) : (
              <p className="text-muted-foreground">{t("noSelection")}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
