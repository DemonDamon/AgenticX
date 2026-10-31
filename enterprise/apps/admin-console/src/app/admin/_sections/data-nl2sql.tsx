"use client";

import { useMemo, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Label,
  PageHeader,
  Textarea,
} from "@agenticx/ui";
import { useTranslations } from "next-intl";
import { adminFetch } from "../../../lib/admin-client-auth";

type QueryMode = "explain" | "execute";

type Nl2SqlResponse = {
  sql: string;
  rows: Array<Record<string, unknown>>;
  refused: boolean;
  reason: string | null;
  mode: string;
  executed: boolean;
  code: string | null;
  denial_zh: string | null;
  backend?: string;
};

const DEFAULT_QUESTION = "上月华东大区 GMV 和退货率分别是多少？";

export default function DataNl2SqlSection() {
  const t = useTranslations("pages.admin.dataNl2sql");
  const [question, setQuestion] = useState(DEFAULT_QUESTION);
  const [mode, setMode] = useState<QueryMode>("explain");
  const [forcedSql, setForcedSql] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Nl2SqlResponse | null>(null);

  const rowKeys = useMemo(() => {
    const first = result?.rows?.[0];
    return first ? Object.keys(first) : [];
  }, [result]);

  async function run() {
    setBusy(true);
    setError("");
    try {
      const body: Record<string, string> = { question: question.trim(), mode };
      if (forcedSql.trim()) body.sql = forcedSql.trim();
      const res = await adminFetch("/api/admin/data-suite/nl2sql", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || t("runFailed"));
      }
      const json = (await res.json()) as { data: Nl2SqlResponse };
      setResult(json.data);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : t("runFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6" data-testid="data-nl2sql-page">
      <PageHeader title={t("title")} description={t("description")} />

      <Card data-testid="data-nl2sql-form">
        <CardHeader>
          <CardTitle>{t("formTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="data-nl2sql-question">{t("question")}</Label>
            <Textarea
              id="data-nl2sql-question"
              data-testid="data-nl2sql-question"
              rows={3}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={DEFAULT_QUESTION}
            />
          </div>

          <div className="space-y-2">
            <Label>{t("modeLabel")}</Label>
            <div
              className="inline-flex rounded-md border p-1"
              role="group"
              aria-label={t("modeLabel")}
              data-testid="data-nl2sql-mode"
            >
              <Button
                type="button"
                size="sm"
                variant={mode === "explain" ? "default" : "ghost"}
                data-testid="data-nl2sql-mode-explain"
                aria-pressed={mode === "explain"}
                onClick={() => setMode("explain")}
              >
                {t("modeExplain")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === "execute" ? "default" : "ghost"}
                data-testid="data-nl2sql-mode-execute"
                aria-pressed={mode === "execute"}
                onClick={() => setMode("execute")}
              >
                {t("modeExecute")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("modeHint")}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="data-nl2sql-forced-sql">{t("forcedSql")}</Label>
            <Textarea
              id="data-nl2sql-forced-sql"
              data-testid="data-nl2sql-forced-sql"
              rows={2}
              value={forcedSql}
              onChange={(e) => setForcedSql(e.target.value)}
              placeholder={t("forcedSqlHint")}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              data-testid="data-nl2sql-run"
              disabled={busy || !question.trim()}
              onClick={() => void run()}
            >
              {busy ? t("running") : t("run")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              data-testid="data-nl2sql-demo-deny"
              disabled={busy}
              onClick={() => {
                setMode("execute");
                setForcedSql("DELETE FROM retail_monthly WHERE region = '华东'");
                setQuestion("尝试删除华东零售月表（写闸演示）");
              }}
            >
              {t("demoDeny")}
            </Button>
          </div>
          {error ? (
            <p className="text-sm text-destructive" data-testid="data-nl2sql-error">
              {error}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {result ? (
        <Card data-testid="data-nl2sql-result">
          <CardHeader>
            <CardTitle>{t("resultTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div data-testid="data-nl2sql-result-mode">
              <span className="text-muted-foreground">{t("resultMode")}: </span>
              {result.mode === "explain" ? t("modeExplain") : t("modeExecute")}
              {result.executed ? ` · ${t("executedYes")}` : ` · ${t("executedNo")}`}
            </div>
            <div>
              <div className="mb-1 text-muted-foreground">{t("sqlDraft")}</div>
              <pre
                className="overflow-x-auto rounded border bg-muted/40 p-3 font-mono text-xs"
                data-testid="data-nl2sql-sql"
              >
                {result.sql || "—"}
              </pre>
            </div>
            {result.refused ? (
              <div
                className="rounded border border-destructive/40 bg-destructive/5 p-3"
                data-testid="data-nl2sql-denial"
                role="alert"
              >
                <div className="font-medium text-destructive">{t("deniedTitle")}</div>
                <div data-testid="data-nl2sql-denial-reason">
                  {result.denial_zh || result.reason || t("deniedFallback")}
                </div>
                {result.code ? (
                  <div className="mt-1 font-mono text-xs text-muted-foreground">
                    {t("errorCode")}: {result.code}
                  </div>
                ) : null}
              </div>
            ) : null}
            {!result.refused && result.mode === "explain" ? (
              <p className="text-muted-foreground" data-testid="data-nl2sql-explain-note">
                {t("explainNote")}
              </p>
            ) : null}
            {!result.refused && result.executed ? (
              <div data-testid="data-nl2sql-rows">
                <div className="mb-1 text-muted-foreground">{t("rowsTitle")}</div>
                {result.rows.length === 0 ? (
                  <p>{t("rowsEmpty")}</p>
                ) : (
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="text-muted-foreground">
                        {rowKeys.map((k) => (
                          <th key={k} className="py-1 pr-3">
                            {k}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((row, idx) => (
                        <tr key={idx}>
                          {rowKeys.map((k) => (
                            <td key={k} className="py-1 pr-3 font-mono">
                              {String(row[k] ?? "")}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
