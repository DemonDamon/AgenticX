"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageHeader,
} from "@agenticx/ui";
import { useTranslations } from "next-intl";
import { adminFetch } from "../../../lib/admin-client-auth";

type IdType = { name: string; priority: number };
type Profile = {
  name: string;
  id_types: IdType[];
  merge: { priority: string[]; on_conflict: string };
};
type Conflict = {
  id: string;
  snapshot_id: string;
  profile_name: string;
  id_type: string;
  values: unknown[];
  rows: number[];
  status: string;
  decision: string | null;
  chosen_value: unknown;
  note: string | null;
  resolved_at: string | null;
};
type SnapshotDiff = {
  left_id: string;
  right_id: string;
  only_left_subject_ids: string[];
  only_right_subject_ids: string[];
  shared_subject_link_changes: Array<{ subject_id: string }>;
  left_conflicts: number;
  right_conflicts: number;
};

const STATUS_LABEL: Record<string, string> = {
  open: "待裁决",
  resolved: "已裁决",
};
const DECISION_LABEL: Record<string, string> = {
  keep_value: "保留取值",
  reject_merge: "拒绝合并",
};

export default function DataIdmappingSection() {
  const t = useTranslations("pages.admin.dataIdmapping");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [snapshotIds, setSnapshotIds] = useState<string[]>([]);
  const [leftId, setLeftId] = useState("");
  const [rightId, setRightId] = useState("");
  const [diff, setDiff] = useState<SnapshotDiff | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [fromApi, setFromApi] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, cRes, sRes] = await Promise.all([
        adminFetch("/api/admin/data-suite/idmapping/profiles"),
        adminFetch("/api/admin/data-suite/idmapping/conflicts"),
        adminFetch("/api/admin/data-suite/idmapping/snapshots"),
      ]);
      if (!pRes.ok || !cRes.ok || !sRes.ok) {
        setFromApi(false);
        setMessage(t("loadFailed"));
        return;
      }
      const pBody = (await pRes.json()) as { data: { profiles: Profile[] } };
      const cBody = (await cRes.json()) as { data: { conflicts: Conflict[] } };
      const sBody = (await sRes.json()) as { data: { snapshot_ids: string[] } };
      setProfiles(pBody.data.profiles ?? []);
      setConflicts(cBody.data.conflicts ?? []);
      const ids = sBody.data.snapshot_ids ?? [];
      setSnapshotIds(ids);
      setLeftId((prev) => prev || ids[0] || "");
      setRightId((prev) => prev || ids[1] || ids[0] || "");
      setFromApi(true);
      setMessage("");
    } catch {
      setFromApi(false);
      setMessage(t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openConflicts = useMemo(
    () => conflicts.filter((c) => c.status === "open"),
    [conflicts],
  );

  async function runSampleMerge() {
    setBusy(true);
    setMessage("");
    try {
      const res = await adminFetch("/api/admin/data-suite/idmapping/merge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ use_sample: true }),
      });
      const json = (await res.json()) as { message?: string };
      if (!res.ok) {
        setMessage(json.message || t("actionFailed"));
        return;
      }
      setMessage(t("mergeOk"));
      await refresh();
    } catch {
      setMessage(t("actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function adjudicate(cfl: Conflict, decision: "keep_value" | "reject_merge") {
    setBusy(true);
    setMessage("");
    try {
      const res = await adminFetch("/api/admin/data-suite/idmapping/conflicts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conflict_id: cfl.id,
          decision,
          chosen_value: decision === "keep_value" ? cfl.values[0] : undefined,
          note: decision === "keep_value" ? "管理台保留首个取值" : "管理台拒绝合并",
        }),
      });
      const json = (await res.json()) as { message?: string };
      if (!res.ok) {
        setMessage(json.message || t("actionFailed"));
        return;
      }
      setMessage(t("resolveOk"));
      await refresh();
    } catch {
      setMessage(t("actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function runCompare() {
    if (!leftId || !rightId) {
      setMessage(t("needTwoSnapshots"));
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const res = await adminFetch(
        `/api/admin/data-suite/idmapping/snapshots?left=${encodeURIComponent(leftId)}&right=${encodeURIComponent(rightId)}`,
      );
      const json = (await res.json()) as { message?: string; data?: { diff: SnapshotDiff } };
      if (!res.ok || !json.data?.diff) {
        setMessage(json.message || t("actionFailed"));
        return;
      }
      setDiff(json.data.diff);
      setMessage(t("compareOk"));
    } catch {
      setMessage(t("actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6" data-testid="data-idmapping-page">
      <PageHeader title={t("title")} description={t("description")} />

      <Card data-testid="data-idmapping-profiles">
        <CardHeader>
          <CardTitle>{t("profilesTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">{t("loading")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="data-idmapping-profiles-table">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">{t("col.profile")}</th>
                    <th className="py-2 pr-4 font-medium">{t("col.idTypes")}</th>
                    <th className="py-2 pr-4 font-medium">{t("col.priority")}</th>
                    <th className="py-2 font-medium">{t("col.onConflict")}</th>
                  </tr>
                </thead>
                <tbody>
                  {profiles.map((p) => (
                    <tr
                      key={p.name}
                      className="border-b last:border-0"
                      data-testid={`data-idmapping-profile-${p.name}`}
                    >
                      <td className="py-2 pr-4 font-mono text-xs">{p.name}</td>
                      <td className="py-2 pr-4">
                        {p.id_types.map((t) => t.name).join("、")}
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs">
                        {p.merge.priority.join(" → ")}
                      </td>
                      <td className="py-2">
                        {p.merge.on_conflict === "reject" ? "拒绝合并" : "优先策略"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              data-testid="data-idmapping-merge"
              disabled={busy}
              onClick={() => void runSampleMerge()}
            >
              {t("runMerge")}
            </Button>
          </div>
          {fromApi ? (
            <p className="mt-4 text-xs text-muted-foreground" data-testid="data-idmapping-api-source">
              {t("apiSource")}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card data-testid="data-idmapping-conflicts">
        <CardHeader>
          <CardTitle>
            {t("conflictsTitle")}
            {openConflicts.length > 0 ? `（${openConflicts.length}）` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {conflicts.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("conflictsEmpty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="data-idmapping-conflicts-table">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">{t("col.conflictId")}</th>
                    <th className="py-2 pr-4 font-medium">{t("col.idType")}</th>
                    <th className="py-2 pr-4 font-medium">{t("col.values")}</th>
                    <th className="py-2 pr-4 font-medium">{t("col.status")}</th>
                    <th className="py-2 font-medium">{t("col.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {conflicts.map((c) => (
                    <tr
                      key={c.id}
                      className="border-b last:border-0"
                      data-testid={`data-idmapping-conflict-${c.id}`}
                    >
                      <td className="py-2 pr-4 font-mono text-xs">{c.id}</td>
                      <td className="py-2 pr-4">{c.id_type}</td>
                      <td className="py-2 pr-4 font-mono text-xs">
                        {c.values.map(String).join(" / ")}
                      </td>
                      <td className="py-2 pr-4">
                        {STATUS_LABEL[c.status] || c.status}
                        {c.decision ? ` · ${DECISION_LABEL[c.decision] || c.decision}` : ""}
                      </td>
                      <td className="py-2">
                        {c.status === "open" ? (
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={busy}
                              data-testid={`data-idmapping-keep-${c.id}`}
                              onClick={() => void adjudicate(c, "keep_value")}
                            >
                              {t("keepValue")}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              data-testid={`data-idmapping-reject-${c.id}`}
                              onClick={() => void adjudicate(c, "reject_merge")}
                            >
                              {t("rejectMerge")}
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {c.chosen_value != null ? String(c.chosen_value) : "—"}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="data-idmapping-snapshots">
        <CardHeader>
          <CardTitle>{t("snapshotsTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">{t("leftSnapshot")}</span>
              <select
                className="rounded border bg-background px-2 py-1 font-mono text-xs"
                data-testid="data-idmapping-left"
                value={leftId}
                onChange={(e) => setLeftId(e.target.value)}
              >
                {snapshotIds.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">{t("rightSnapshot")}</span>
              <select
                className="rounded border bg-background px-2 py-1 font-mono text-xs"
                data-testid="data-idmapping-right"
                value={rightId}
                onChange={(e) => setRightId(e.target.value)}
              >
                {snapshotIds.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>
            <Button
              data-testid="data-idmapping-compare"
              disabled={busy || snapshotIds.length < 1}
              onClick={() => void runCompare()}
            >
              {t("compare")}
            </Button>
          </div>
          {diff ? (
            <div
              className="rounded border bg-muted/20 p-3 text-sm space-y-1"
              data-testid="data-idmapping-diff"
            >
              <p>
                {t("diffOnlyLeft")}: {diff.only_left_subject_ids.length}
              </p>
              <p>
                {t("diffOnlyRight")}: {diff.only_right_subject_ids.length}
              </p>
              <p>
                {t("diffLinkChanges")}: {diff.shared_subject_link_changes.length}
              </p>
              <p>
                {t("diffConflicts")}: {diff.left_conflicts} / {diff.right_conflicts}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("snapshotsHint")}</p>
          )}
        </CardContent>
      </Card>

      {message ? (
        <p className="text-sm text-muted-foreground" data-testid="data-idmapping-message">
          {message}
        </p>
      ) : null}
    </div>
  );
}
