"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  SAMPLE_DISAMBIGUATION_SESSIONS,
  type DisambiguationRequest,
  type DisambiguationSession,
} from "../../../lib/disambiguation-types";

export default function AdminDisambiguationSection() {
  const t = useTranslations("pages.admin.disambiguation");
  const [sessions, setSessions] = useState<DisambiguationSession[]>([
    ...SAMPLE_DISAMBIGUATION_SESSIONS,
  ]);
  const [selectedId, setSelectedId] = useState<string>(
    SAMPLE_DISAMBIGUATION_SESSIONS[0]?.id ?? "",
  );
  const [detail, setDetail] = useState<DisambiguationSession | null>(
    SAMPLE_DISAMBIGUATION_SESSIONS[0] ?? null,
  );
  const [fromApi, setFromApi] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [freeText, setFreeText] = useState("");

  const pending: DisambiguationRequest | null = detail?.pending?.[0] ?? null;

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch("/api/admin/disambiguation/sessions");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { data?: { sessions?: DisambiguationSession[] } };
      const next = json.data?.sessions ?? [];
      const list = next.length ? next : [...SAMPLE_DISAMBIGUATION_SESSIONS];
      setSessions(list);
      setFromApi(Boolean(next.length));
      const prefer = list.find((s) => s.id === selectedId) ?? list[0];
      if (prefer) setSelectedId(prefer.id);
    } catch {
      setSessions([...SAMPLE_DISAMBIGUATION_SESSIONS]);
      setFromApi(false);
      setSelectedId(SAMPLE_DISAMBIGUATION_SESSIONS[0]?.id ?? "");
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  const loadDetail = useCallback(async (id: string) => {
    if (!id) return;
    try {
      const res = await adminFetch(
        `/api/admin/disambiguation/sessions/${encodeURIComponent(id)}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { data?: { session?: DisambiguationSession } };
      setDetail(json.data?.session ?? null);
      setFromApi(true);
      setSelectedIds([]);
      setFreeText("");
    } catch {
      setDetail(SAMPLE_DISAMBIGUATION_SESSIONS.find((s) => s.id === id) ?? null);
      setSelectedIds([]);
      setFreeText("");
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const modeLabel = useMemo(() => {
    if (!pending) return "—";
    if (pending.mode === "candidate_select") return t("mode.candidateSelect");
    if (pending.mode === "info_supplement") return t("mode.infoSupplement");
    return t("mode.conflictResolve");
  }, [pending, t]);

  function toggleCandidate(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function submit(cancelled = false) {
    if (!detail || !pending) return;
    setBusy(true);
    try {
      const body = {
        request_id: pending.id,
        selected_ids: cancelled ? [] : selectedIds,
        free_text: cancelled ? null : freeText || null,
        cancelled,
      };
      const res = await adminFetch(
        `/api/admin/disambiguation/sessions/${encodeURIComponent(detail.id)}/respond`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) throw new Error(await res.text());
      toast.success(cancelled ? t("cancelled") : t("submitSuccess"));
      await loadList();
      await loadDetail(detail.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("submitFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function reseed() {
    setBusy(true);
    try {
      const res = await adminFetch("/api/admin/disambiguation/seed", { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      toast.success(t("reseedSuccess"));
      await loadList();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("reseedFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6" data-testid="disambiguation-page">
      <PageHeader title={t("title")} description={t("description")} />
      <div className="flex flex-wrap gap-2">
        <Button
          data-testid="disambiguation-reseed"
          variant="secondary"
          disabled={busy}
          onClick={() => void reseed()}
        >
          {t("reseed")}
        </Button>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card data-testid="disambiguation-list">
          <CardHeader>
            <CardTitle>{t("listTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">{t("loading")}</p>
            ) : (
              <table className="w-full text-sm" data-testid="disambiguation-table">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-2 pr-2">{t("col.id")}</th>
                    <th className="py-2 pr-2">{t("col.source")}</th>
                    <th className="py-2 pr-2">{t("col.status")}</th>
                    <th className="py-2">{t("col.pending")}</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr
                      key={s.id}
                      data-testid={`disambiguation-row-${s.id}`}
                      className={
                        s.id === selectedId
                          ? "cursor-pointer bg-muted/50"
                          : "cursor-pointer hover:bg-muted/30"
                      }
                      onClick={() => setSelectedId(s.id)}
                    >
                      <td className="py-2 pr-2 font-mono text-xs">{s.id}</td>
                      <td className="py-2 pr-2">{s.source}</td>
                      <td className="py-2 pr-2">{s.status}</td>
                      <td className="py-2">{s.pending?.length ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p
              className="mt-4 text-xs text-muted-foreground"
              data-testid="disambiguation-source"
            >
              {fromApi ? t("apiSource") : t("stubNote")}
            </p>
          </CardContent>
        </Card>

        <Card data-testid="disambiguation-panel">
          <CardHeader>
            <CardTitle>{t("panelTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {detail ? (
              <>
                <div data-testid="disambiguation-detail-id">
                  <span className="text-muted-foreground">{t("col.id")}: </span>
                  <span className="font-mono">{detail.id}</span>
                </div>
                <div data-testid="disambiguation-detail-status">
                  <span className="text-muted-foreground">{t("col.status")}: </span>
                  {detail.status}
                </div>
                <div>
                  <span className="text-muted-foreground">{t("col.source")}: </span>
                  {detail.source}
                </div>

                {pending ? (
                  <div
                    className="space-y-3 rounded border p-3"
                    data-testid="disambiguation-choice-panel"
                    data-mode={pending.mode}
                  >
                    <div data-testid="disambiguation-mode">
                      <span className="text-muted-foreground">{t("col.mode")}: </span>
                      {modeLabel}
                    </div>
                    <p data-testid="disambiguation-prompt">{pending.prompt}</p>

                    {(pending.mode === "candidate_select" ||
                      pending.mode === "conflict_resolve") &&
                      pending.candidates.length > 0 && (
                        <ul className="space-y-2" data-testid="disambiguation-candidates">
                          {pending.candidates.map((c) => (
                            <li key={c.id}>
                              <label className="flex cursor-pointer items-center gap-2">
                                <input
                                  type="checkbox"
                                  data-testid={`disambiguation-candidate-${c.id}`}
                                  checked={selectedIds.includes(c.id)}
                                  onChange={() => toggleCandidate(c.id)}
                                />
                                <span className="font-mono text-xs">
                                  {c.label}
                                  {c.score != null ? ` · ${c.score}` : ""}
                                </span>
                              </label>
                            </li>
                          ))}
                        </ul>
                      )}

                    {pending.mode === "conflict_resolve" && pending.conflicts.length > 0 && (
                      <div data-testid="disambiguation-conflicts" className="space-y-2">
                        <h3 className="font-medium">{t("conflictsTitle")}</h3>
                        {pending.conflicts.map((c, i) => (
                          <div key={`${c.field}-${i}`} className="rounded bg-muted/40 p-2 font-mono text-xs">
                            <div>
                              {c.field}: {(c.values || []).map(String).join(" | ")}
                            </div>
                            <div className="text-muted-foreground">
                              sources={(c.sources || []).join(", ")} {c.reason || ""}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {(pending.mode === "info_supplement" ||
                      pending.allow_free_text ||
                      pending.mode === "conflict_resolve") && (
                      <div className="space-y-2">
                        <Label htmlFor="daq-free-text">{t("freeText")}</Label>
                        <Input
                          id="daq-free-text"
                          data-testid="disambiguation-free-text"
                          value={freeText}
                          onChange={(e) => setFreeText(e.target.value)}
                          placeholder={t("freeTextPlaceholder")}
                        />
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                      <Button
                        data-testid="disambiguation-submit"
                        disabled={busy}
                        onClick={() => void submit(false)}
                      >
                        {t("submit")}
                      </Button>
                      <Button
                        data-testid="disambiguation-cancel"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => void submit(true)}
                      >
                        {t("cancel")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground" data-testid="disambiguation-no-pending">
                    {t("noPending")}
                  </p>
                )}

                <div>
                  <h3 className="mb-2 font-medium">{t("slotsTitle")}</h3>
                  {Object.keys(detail.slots || {}).length === 0 ? (
                    <p className="text-muted-foreground">{t("noSlots")}</p>
                  ) : (
                    <ul className="space-y-1" data-testid="disambiguation-slots">
                      {Object.entries(detail.slots).map(([k, v]) => (
                        <li key={k} className="font-mono text-xs">
                          {k} = {JSON.stringify(v)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <h3 className="mb-2 font-medium">{t("resolvedTitle")}</h3>
                  {(detail.resolved || []).length === 0 ? (
                    <p className="text-muted-foreground">{t("noResolved")}</p>
                  ) : (
                    <ul className="space-y-1" data-testid="disambiguation-resolved">
                      {detail.resolved.map((row, i) => (
                        <li key={`${row.request.id}-${i}`} className="font-mono text-xs">
                          {row.request.mode} · req={row.request.id} · cancelled=
                          {String(Boolean(row.response.cancelled))}
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
