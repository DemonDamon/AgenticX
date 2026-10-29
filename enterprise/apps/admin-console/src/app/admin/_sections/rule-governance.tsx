"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageHeader,
} from "@agenticx/ui";
import { useTranslations } from "next-intl";
import { adminFetch } from "../../../lib/admin-client-auth";
import {
  SAMPLE_RULES,
  type ExecutionRow,
  type RuleRow,
} from "../../../lib/rules-types";

export default function AdminRuleGovernanceSection() {
  const t = useTranslations("pages.admin.ruleGovernance");
  const [rules, setRules] = useState<RuleRow[]>([...SAMPLE_RULES]);
  const [selectedId, setSelectedId] = useState<string>(SAMPLE_RULES[0]?.id ?? "");
  const [detail, setDetail] = useState<RuleRow | null>(SAMPLE_RULES[0] ?? null);
  const [executions, setExecutions] = useState<ExecutionRow[]>([]);
  const [fromApi, setFromApi] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch("/api/admin/rules");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { data?: { rules?: RuleRow[] } };
      const next = json.data?.rules ?? [];
      const list = next.length ? next : [...SAMPLE_RULES];
      setRules(list);
      setFromApi(Boolean(next.length));
      const prefer = list.find((r) => r.id === selectedId) ?? list[0];
      if (prefer) setSelectedId(prefer.id);
    } catch {
      setRules([...SAMPLE_RULES]);
      setFromApi(false);
      setSelectedId(SAMPLE_RULES[0]?.id ?? "");
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  const loadDetail = useCallback(async (id: string) => {
    if (!id) return;
    try {
      const res = await adminFetch(`/api/admin/rules/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        data?: { rule?: RuleRow; executions?: ExecutionRow[] };
      };
      setDetail(json.data?.rule ?? null);
      setExecutions(json.data?.executions ?? []);
      setFromApi(true);
    } catch {
      const fallback = SAMPLE_RULES.find((r) => r.id === id) ?? null;
      setDetail(fallback);
      setExecutions([]);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const bodyObject =
    detail && typeof detail.body?.object === "string" ? detail.body.object : "—";

  return (
    <div className="space-y-6" data-testid="rule-governance-page">
      <PageHeader title={t("title")} description={t("description")} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card data-testid="rule-governance-list">
          <CardHeader>
            <CardTitle>{t("listTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">{t("loading")}</p>
            ) : (
              <table className="w-full text-sm" data-testid="rule-governance-table">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-2 pr-2">{t("col.id")}</th>
                    <th className="py-2 pr-2">{t("col.name")}</th>
                    <th className="py-2 pr-2">{t("col.status")}</th>
                    <th className="py-2">{t("col.enabled")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((rule) => (
                    <tr
                      key={rule.id}
                      data-testid={`rule-governance-row-${rule.id}`}
                      className={
                        rule.id === selectedId
                          ? "cursor-pointer bg-muted/50"
                          : "cursor-pointer hover:bg-muted/30"
                      }
                      onClick={() => setSelectedId(rule.id)}
                    >
                      <td className="py-2 pr-2 font-mono text-xs">{rule.id}</td>
                      <td className="py-2 pr-2">{rule.name}</td>
                      <td className="py-2 pr-2">{rule.status}</td>
                      <td className="py-2">{rule.enabled ? "yes" : "no"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="mt-4 text-xs text-muted-foreground" data-testid="rule-governance-source">
              {fromApi ? t("apiSource") : t("stubNote")}
            </p>
          </CardContent>
        </Card>

        <Card data-testid="rule-governance-detail">
          <CardHeader>
            <CardTitle>{t("detailTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {detail ? (
              <>
                <div data-testid="rule-governance-detail-id">
                  <span className="text-muted-foreground">{t("col.id")}: </span>
                  <span className="font-mono">{detail.id}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t("col.name")}: </span>
                  {detail.name}
                </div>
                <div>
                  <span className="text-muted-foreground">{t("col.status")}: </span>
                  {detail.status} (v{detail.version})
                </div>
                <div>
                  <span className="text-muted-foreground">{t("col.object")}: </span>
                  {bodyObject}
                </div>
                <div>
                  <span className="text-muted-foreground">{t("col.tags")}: </span>
                  {(detail.meta?.tags ?? []).join(", ") || "—"}
                </div>
                <div>
                  <h3 className="mb-2 font-medium">{t("executionsTitle")}</h3>
                  {executions.length === 0 ? (
                    <p className="text-muted-foreground">{t("noExecutions")}</p>
                  ) : (
                    <ul className="space-y-1" data-testid="rule-governance-executions">
                      {executions.map((ex) => (
                        <li key={ex.id} className="font-mono text-xs">
                          {ex.id} · {ex.status} · nodes={ex.nodes?.length ?? 0}
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
