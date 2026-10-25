import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useAppStore } from "../store";
import { studioFetch } from "../utils/studio-fetch";

type ToolPolicy = "always_allow" | "always_ask";

type PublishReport = {
  model: string;
  included_tools: { name: string; policy: ToolPolicy }[];
  disabled_tools: string[];
  excluded_tools: { name: string; reason: string }[];
  removed_credential_refs: string[];
  redacted_secrets: number;
  replaced_local_paths: number;
  warnings: string[];
  errors: string[];
};

type PublishResultBody = {
  version: number;
  created: boolean;
  lifecycle: "draft" | "published" | "recalled";
  routing_mode: "follow_latest" | "pinned";
  effective_version: number;
};

type PreviewBody = {
  ok?: boolean;
  message?: string;
  report?: PublishReport;
  result?: PublishResultBody;
};

type Feedback =
  | { tone: "success" | "warning" | "error"; text: string };

type Props = { avatarId: string; avatarName: string };

function policyLabel(policy: ToolPolicy, t: (key: string) => string): string {
  switch (policy) {
    case "always_allow":
      return t("avatar.enterprisePublish.policy.always_allow");
    case "always_ask":
      return t("avatar.enterprisePublish.policy.always_ask");
    default: {
      const exhaustive: never = policy;
      return exhaustive;
    }
  }
}

function resultText(result: PublishResultBody, t: (key: string, opts?: Record<string, unknown>) => string): Feedback {
  if (!result.created) {
    return {
      tone: "warning",
      text: t("avatar.enterprisePublish.result.unchanged", { version: result.version }),
    };
  }
  if (result.lifecycle === "draft") {
    return {
      tone: "success",
      text: t("avatar.enterprisePublish.result.draft", { version: result.version }),
    };
  }
  if (result.routing_mode === "pinned") {
    return {
      tone: "success",
      text: t("avatar.enterprisePublish.result.pinned", {
        version: result.version,
        effective: result.effective_version,
      }),
    };
  }
  return {
    tone: "success",
    text: t("avatar.enterprisePublish.result.created", { version: result.version }),
  };
}

export function AvatarEnterprisePublishTab({ avatarId, avatarName }: Props): JSX.Element {
  const { t } = useTranslation("settings");
  const apiToken = useAppStore((state) => state.apiToken);
  const [loading, setLoading] = useState(true);
  const [loadMessage, setLoadMessage] = useState("");
  const [report, setReport] = useState<PublishReport | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setLoadMessage("");
      setReport(null);
      setErrors([]);
      try {
        const res = await studioFetch(
          `/api/avatars/${encodeURIComponent(avatarId)}/enterprise-publish`,
          {
            method: "POST",
            apiToken,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dry_run: true }),
          },
        );
        if (cancelled) return;
        if (res.status === 409) {
          setLoadMessage(t("avatar.enterprisePublish.err.login"));
          return;
        }
        if (res.status === 404) {
          setLoadMessage(t("avatar.enterprisePublish.err.notFound"));
          return;
        }
        const body = (await res.json()) as PreviewBody;
        if (cancelled) return;
        if (!res.ok || body.ok === false) {
          const listed = body.report?.errors ?? [];
          setReport(body.report ?? null);
          setErrors(listed.length > 0 ? listed : [String(body.message || res.status)]);
          return;
        }
        setReport(body.report ?? null);
      } catch (error) {
        if (!cancelled) {
          setLoadMessage(t("avatar.enterprisePublish.err.load", { message: String(error) }));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiToken, avatarId, t]);

  const submit = async () => {
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await studioFetch(
        `/api/avatars/${encodeURIComponent(avatarId)}/enterprise-publish`,
        {
          method: "POST",
          apiToken,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dry_run: false, note }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as PreviewBody;
      if (body.ok && body.result) {
        setFeedback(resultText(body.result, t));
        return;
      }
      const message = String(body.message || t("avatar.enterprisePublish.err.load", { message: `HTTP ${res.status}` }));
      setFeedback({ tone: "error", text: message });
    } catch (error) {
      setFeedback({
        tone: "error",
        text: t("avatar.enterprisePublish.err.load", { message: String(error) }),
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-text-subtle">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {t("avatar.loading")}
      </div>
    );
  }

  if (loadMessage) {
    return (
      <div role="alert" className="rounded-lg border border-border bg-surface-card px-3 py-2 text-xs text-rose-400">
        {loadMessage}
      </div>
    );
  }

  const canSubmit = errors.length === 0 && report != null;
  const securityClean =
    (report?.removed_credential_refs.length ?? 0) === 0 &&
    (report?.redacted_secrets ?? 0) === 0 &&
    (report?.replaced_local_paths ?? 0) === 0;
  const feedbackClass =
    feedback?.tone === "success"
      ? "text-emerald-400"
      : feedback?.tone === "warning"
        ? "text-amber-400"
        : "text-rose-400";

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-text-strong">{t("avatar.enterprisePublish.title")}</h3>
        <p className="mt-1 text-xs text-text-muted">{avatarName}</p>
        <p className="mt-1 text-xs text-text-subtle">{t("avatar.enterprisePublish.intro")}</p>
      </div>
      <p className="rounded-lg border border-border bg-surface-card px-3 py-2 text-xs text-text-subtle">
        {t("avatar.enterprisePublish.savedHint")}
      </p>
      {errors.length > 0 ? (
        <div role="alert" className="space-y-1 rounded-lg border border-border bg-surface-card px-3 py-2 text-xs text-rose-400">
          {errors.map((error) => (
            <p key={error}>{error}</p>
          ))}
        </div>
      ) : null}
      {report ? (
        <>
          <section className="rounded-lg border border-border bg-surface-card px-3 py-2">
            <div className="text-xs text-text-muted">{t("avatar.enterprisePublish.model")}</div>
            <div className="mt-1 text-sm text-text-strong">{report.model}</div>
          </section>
          <section className="rounded-lg border border-border bg-surface-card px-3 py-2">
            <div className="text-xs text-text-muted">{t("avatar.enterprisePublish.tools")}</div>
            <ul className="mt-2 space-y-1 text-xs text-text-primary">
              {report.included_tools.map((tool) => (
                <li key={tool.name} className="flex items-center justify-between gap-3">
                  <span>{tool.name}</span>
                  <span className="text-text-subtle">{policyLabel(tool.policy, t)}</span>
                </li>
              ))}
              {report.disabled_tools.map((name) => (
                <li key={name} className="flex items-center justify-between gap-3">
                  <span>{name}</span>
                  <span className="text-text-subtle">{t("avatar.enterprisePublish.disabled")}</span>
                </li>
              ))}
              {report.excluded_tools.map((tool) => (
                <li key={tool.name} className="flex items-center justify-between gap-3">
                  <span>{tool.name}</span>
                  <span className="text-text-subtle">
                    {t("avatar.enterprisePublish.excluded")}：{tool.reason}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section className="rounded-lg border border-border bg-surface-card px-3 py-2">
            <div className="text-xs text-text-muted">{t("avatar.enterprisePublish.security")}</div>
            <div className="mt-1 space-y-1 text-xs text-text-primary">
              {report.removed_credential_refs.length > 0 ? (
                <p>{t("avatar.enterprisePublish.removedRefs", { names: report.removed_credential_refs.join("、") })}</p>
              ) : null}
              {report.redacted_secrets > 0 ? (
                <p>{t("avatar.enterprisePublish.redacted", { count: report.redacted_secrets })}</p>
              ) : null}
              {report.replaced_local_paths > 0 ? (
                <p>{t("avatar.enterprisePublish.paths", { count: report.replaced_local_paths })}</p>
              ) : null}
              {securityClean ? <p>{t("avatar.enterprisePublish.clean")}</p> : null}
            </div>
          </section>
          {report.warnings.length > 0 ? (
            <section>
              <div className="text-xs text-text-muted">{t("avatar.enterprisePublish.notes")}</div>
              <ul className="mt-1 space-y-1">
                {report.warnings.map((warning) => (
                  <li key={warning} className="text-xs text-text-faint">
                    {warning}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
      {canSubmit ? (
        <div className="space-y-2">
          <label className="block text-xs text-text-muted" htmlFor="enterprise-publish-note">
            {t("avatar.enterprisePublish.notes")}
          </label>
          <textarea
            id="enterprise-publish-note"
            maxLength={500}
            value={note}
            placeholder={t("avatar.enterprisePublish.notePlaceholder")}
            onChange={(event) => setNote(event.target.value)}
            className="min-h-[88px] w-full resize-y rounded-lg border border-border bg-surface-card px-3 py-2 text-sm text-text-primary"
          />
          {feedback ? <p className={`text-xs ${feedbackClass}`}>{feedback.text}</p> : null}
          <button
            type="button"
            disabled={submitting}
            onClick={() => void submit()}
            className="inline-flex items-center gap-1.5 rounded-md bg-[var(--ui-btn-primary-bg)] px-3 py-1.5 text-xs font-medium text-[var(--ui-btn-primary-text)] transition hover:bg-[var(--ui-btn-primary-bg-hover)] disabled:opacity-40"
          >
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {t("avatar.enterprisePublish.submit")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
