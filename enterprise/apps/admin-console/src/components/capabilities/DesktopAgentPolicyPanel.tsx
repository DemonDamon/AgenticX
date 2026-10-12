"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Label, Switch, Textarea, toast } from "@agenticx/ui";
import { useTranslations } from "next-intl";

import { adminFetch } from "../../lib/admin-client-auth";

const EXAMPLES = ["git:push", "mcp:send_*", "bash_exec"] as const;

function toLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function fromLines(items: unknown): string {
  if (!Array.isArray(items)) return "";
  return items.filter((item): item is string => typeof item === "string").join("\n");
}

function appendPattern(current: string, pattern: string): string {
  const lines = toLines(current);
  if (lines.some((line) => line.toLowerCase() === pattern.toLowerCase())) return current;
  const base = current.replace(/\s+$/, "");
  return base ? `${base}\n${pattern}` : pattern;
}

export function DesktopAgentPolicyPanel() {
  const t = useTranslations("pages.admin.capabilities");
  const tc = useTranslations("common");
  const [denied, setDenied] = useState("");
  const [alwaysAsk, setAlwaysAsk] = useState("");
  const [disableSessionAllow, setDisableSessionAllow] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await adminFetch("/api/admin/desktop-agent-policy");
        const json = (await response.json().catch(() => ({}))) as {
          message?: string;
          data?: {
            policy?: {
              deniedTools?: unknown;
              alwaysAskTools?: unknown;
              disableSessionAllow?: unknown;
            };
          };
        };
        if (!response.ok) {
          if (!cancelled) setError(json.message || tc("states.error"));
          return;
        }
        if (cancelled) return;
        const policy = json.data?.policy;
        setDenied(fromLines(policy?.deniedTools));
        setAlwaysAsk(fromLines(policy?.alwaysAskTools));
        setDisableSessionAllow(policy?.disableSessionAllow === true);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : tc("states.error"));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tc]);

  const onSave = useCallback(async () => {
    setSaving(true);
    setError("");
    try {
      const response = await adminFetch("/api/admin/desktop-agent-policy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deniedTools: toLines(denied),
          alwaysAskTools: toLines(alwaysAsk),
          disableSessionAllow,
        }),
      });
      const json = (await response.json().catch(() => ({}))) as {
        message?: string;
        data?: {
          policy?: {
            deniedTools?: unknown;
            alwaysAskTools?: unknown;
            disableSessionAllow?: unknown;
          };
        };
      };
      if (!response.ok) {
        setError(json.message || tc("states.error"));
        return;
      }
      const policy = json.data?.policy;
      if (policy) {
        setDenied(fromLines(policy.deniedTools));
        setAlwaysAsk(fromLines(policy.alwaysAskTools));
        setDisableSessionAllow(policy.disableSessionAllow === true);
      }
      toast.success(t("saved"));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : tc("states.error"));
    } finally {
      setSaving(false);
    }
  }, [alwaysAsk, denied, disableSessionAllow, t, tc]);

  return (
    <div className="max-w-3xl space-y-6">
      <PatternField
        id="agent-policy-denied"
        label={t("deniedTools")}
        hint={t("onePerLine")}
        value={denied}
        onChange={setDenied}
      />
      <PatternField
        id="agent-policy-ask"
        label={t("alwaysAskTools")}
        hint={t("onePerLine")}
        value={alwaysAsk}
        onChange={setAlwaysAsk}
      />
      <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
        <Label htmlFor="agent-policy-session-allow">{t("disableSessionAllow")}</Label>
        <Switch
          id="agent-policy-session-allow"
          checked={disableSessionAllow}
          onCheckedChange={setDisableSessionAllow}
        />
      </div>
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      <div className="flex justify-end">
        <Button type="button" onClick={() => void onSave()} disabled={saving}>
          {tc("actions.save")}
        </Button>
      </div>
    </div>
  );
}

function PatternField({
  id,
  label,
  hint,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        rows={6}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="font-mono text-sm"
      />
      <p className="text-muted-foreground text-xs">{hint}</p>
      <div className="flex flex-wrap gap-2">
        {EXAMPLES.map((example) => (
          <button
            key={`${id}-${example}`}
            type="button"
            className="border-border bg-muted text-foreground rounded-full border px-2.5 py-0.5 text-xs"
            onClick={() => onChange(appendPattern(value, example))}
          >
            {example}
          </button>
        ))}
      </div>
    </div>
  );
}
