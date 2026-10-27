import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import {
  executionLabelKey,
  loadEnterpriseAgentDetail,
  type EnterpriseAgentDetail,
  type ManifestOverrideView,
} from "../../utils/ma-pane";

type Props = { agentId: string; onClose: () => void };

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; status: number }
  | { kind: "ready"; detail: EnterpriseAgentDetail };

function policyText(
  policy: "always_allow" | "always_ask" | null,
  enabled: boolean,
  t: (key: string) => string,
): string {
  if (!enabled) return t("gallery.enterprise.drawer.disabled");
  switch (policy) {
    case "always_allow":
      return t("gallery.enterprise.drawer.alwaysAllow");
    case "always_ask":
      return t("gallery.enterprise.drawer.alwaysAsk");
    case null:
      return t("gallery.enterprise.drawer.inherit");
    default: {
      const neverPolicy: never = policy;
      return neverPolicy;
    }
  }
}

function errorCopy(status: number, t: (key: string) => string): string {
  if (status === 409) return t("gallery.enterprise.drawer.loginRequired");
  if (status === 404) return t("gallery.enterprise.drawer.notFound");
  return t("gallery.enterprise.drawer.loadFailed");
}

export function EnterpriseAgentDrawer({ agentId, onClose }: Props): JSX.Element {
  const { t } = useTranslation("sidebar");
  const { t: tCommon } = useTranslation("common");
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    void (async () => {
      const result = await loadEnterpriseAgentDetail(agentId, { force: attempt > 0 });
      if (cancelled) return;
      if (!result.ok) {
        setState({ kind: "error", status: result.status });
        return;
      }
      setState({ kind: "ready", detail: result.detail });
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId, attempt]);

  const body = (
    <div className="fixed inset-0 z-[80] flex justify-end bg-black/70 backdrop-blur-none">
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={t("gallery.enterprise.viewDefinition")}
        className="flex h-full w-[min(480px,92vw)] flex-col border-l border-border shadow-2xl"
        style={{ backgroundColor: "var(--surface-base-fallback, var(--surface-panel))" }}
      >
        <div className="flex items-center justify-end border-b border-border px-4 py-3">
          <button
            type="button"
            aria-label={tCommon("close")}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-text-strong hover:bg-surface-hover"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {state.kind === "loading" ? <DrawerSkeleton /> : null}
          {state.kind === "error" ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <p className="text-sm text-text-strong">{errorCopy(state.status, t)}</p>
              <button
                type="button"
                className="rounded-md bg-[var(--ui-btn-primary-bg)] px-3 py-1.5 text-[13px] font-medium text-[var(--ui-btn-primary-text)] hover:bg-[var(--ui-btn-primary-bg-hover)]"
                onClick={() => setAttempt((value) => value + 1)}
              >
                {t("gallery.enterprise.drawer.retry")}
              </button>
            </div>
          ) : null}
          {state.kind === "ready" ? <DrawerBody detail={state.detail} /> : null}
        </div>
      </aside>
    </div>
  );

  return createPortal(body, document.body);
}

function DrawerSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      <div className="h-6 w-40 animate-pulse rounded bg-surface-card-strong" />
      <div className="h-4 w-full animate-pulse rounded bg-surface-card" />
      <div className="h-24 w-full animate-pulse rounded bg-surface-card" />
    </div>
  );
}

function DrawerBody({ detail }: { detail: EnterpriseAgentDetail }) {
  const { t } = useTranslation("sidebar");
  const { agent, version } = detail;
  const summary = version.summary;
  const created = version.createdAt ? new Date(version.createdAt) : null;
  const createdLabel = created && !Number.isNaN(created.getTime()) ? created.toLocaleString() : version.createdAt;
  const place = agent.defaultEnvironment
    ? `${agent.defaultEnvironment.name} · ${t(executionLabelKey(agent.executionTarget))}`
    : agent.executionTarget === "cloud"
      ? t("gallery.enterprise.drawer.defaultCloud")
      : t("gallery.enterprise.noEnvironment");

  return (
    <div className="space-y-5 text-sm text-text-strong">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">{agent.displayName}</h2>
          <span className="rounded-md bg-surface-card-strong px-1.5 py-0.5 text-[10px] text-text-strong">
            {t("gallery.enterprise.badge")}
          </span>
          <span className="text-xs text-text-muted">{t("gallery.enterprise.version", { version: version.version })}</span>
        </div>
        {createdLabel ? <p className="mt-1 text-xs text-text-muted">{createdLabel}</p> : null}
        {version.note ? <p className="mt-1 text-xs text-text-muted">{version.note}</p> : null}
      </div>
      {agent.description ? (
        <section>
          <h3 className="text-xs font-medium text-text-muted">{t("gallery.enterprise.drawer.description")}</h3>
          <p className="mt-1 whitespace-pre-wrap">{agent.description}</p>
        </section>
      ) : null}
      <Field label={t("gallery.enterprise.drawer.execution")} value={place} />
      <Field label={t("gallery.enterprise.drawer.model")} value={summary.model || agent.model} />
      <section>
        <h3 className="text-xs font-medium text-text-muted">{t("gallery.enterprise.drawer.system")}</h3>
        <pre className="mt-1 max-h-[240px] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-surface-base p-3 text-[12px] text-text-strong">
          {summary.system}
        </pre>
      </section>
      <section>
        <h3 className="text-xs font-medium text-text-muted">{t("gallery.enterprise.drawer.tools")}</h3>
        <div className="mt-2 space-y-3">
          <div>
            <p className="text-[13px] font-medium">{t("gallery.enterprise.drawer.builtin")}</p>
            {summary.builtin ? (
              <>
                <p className="mt-1 text-xs text-text-muted">
                  {t("gallery.enterprise.drawer.defaultPolicy")}：{policyText(summary.builtin.defaultPolicy, true, t)}
                </p>
                <OverrideTable rows={summary.builtin.overrides} />
              </>
            ) : (
              <p className="mt-1 text-xs text-text-muted">—</p>
            )}
          </div>
          <div>
            <p className="text-[13px] font-medium">{t("gallery.enterprise.drawer.mcp")}</p>
            {summary.mcp.length === 0 ? <p className="mt-1 text-xs text-text-muted">—</p> : null}
            {summary.mcp.map((server) => (
              <div key={server.server} className="mt-2">
                <p className="text-xs text-text-strong">{server.server} · {server.transport}</p>
                <p className="text-xs text-text-muted">
                  {t("gallery.enterprise.drawer.defaultPolicy")}：{policyText(server.defaultPolicy, true, t)}
                </p>
                <OverrideTable rows={server.overrides} />
              </div>
            ))}
          </div>
          <div>
            <p className="text-[13px] font-medium">{t("gallery.enterprise.drawer.custom")}</p>
            {summary.custom.length === 0 ? <p className="mt-1 text-xs text-text-muted">—</p> : null}
            {summary.custom.map((tool) => (
              <p key={tool.name} className="mt-1 text-xs text-text-strong">
                {tool.name}
                {tool.description ? ` · ${tool.description}` : ""}
                {` · ${t("gallery.enterprise.drawer.customHost")}`}
              </p>
            ))}
          </div>
        </div>
      </section>
      <section>
        <h3 className="text-xs font-medium text-text-muted">{t("gallery.enterprise.drawer.skills")}</h3>
        {summary.skills.length === 0 ? <p className="mt-1 text-xs text-text-muted">—</p> : null}
        {summary.skills.map((skill) => (
          <p key={`${skill.source}:${skill.id}`} className="mt-1 text-xs text-text-strong">
            {skill.source} · {skill.id}{skill.version ? ` · ${skill.version}` : ""}
          </p>
        ))}
      </section>
      {summary.welcomeMessage ? (
        <Field label={t("gallery.enterprise.drawer.welcome")} value={summary.welcomeMessage} />
      ) : null}
      {summary.suggestedQuestions.length > 0 ? (
        <section>
          <h3 className="text-xs font-medium text-text-muted">{t("gallery.enterprise.drawer.suggestions")}</h3>
          <ul className="mt-1 list-disc pl-4 text-xs">
            {summary.suggestedQuestions.map((question) => <li key={question}>{question}</li>)}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <section>
      <h3 className="text-xs font-medium text-text-muted">{label}</h3>
      <p className="mt-1 whitespace-pre-wrap text-sm text-text-strong">{value}</p>
    </section>
  );
}

function OverrideTable({ rows }: { rows: ManifestOverrideView[] }) {
  const { t } = useTranslation("sidebar");
  if (rows.length === 0) return null;
  return (
    <table className="mt-1 w-full text-left text-xs">
      <tbody>
        {rows.map((row) => (
          <tr key={row.name} className="border-t border-border">
            <td className="py-1 pr-2 text-text-strong">{row.name}</td>
            <td className="py-1 text-text-muted">{policyText(row.policy, row.enabled, t)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
