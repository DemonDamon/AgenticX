import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, FileText, Sparkles, X } from "lucide-react";
import { HoverTip } from "../ds/HoverTip";
import { ManagedTranscript } from "./ManagedTranscript";
import { EnterpriseAgentDrawer } from "../gallery/EnterpriseAgentDrawer";
import { useManagedSession } from "../../hooks/useManagedSession";
import { useAppStore } from "../../store";
import { avatarBgClass, avatarFgClass, resolveAvatarPaletteKey } from "../../utils/avatar-color";
import { studioFetch } from "../../utils/studio-fetch";
import {
  executionLabelKey,
  forgetManagedSession,
  loadEnterpriseAgentDetail,
  managedAgentIdOf,
  rememberManagedSession,
  type EnterpriseAgentDetail,
} from "../../utils/ma-pane";

type Props = { paneId: string; focused: boolean; onFocus: () => void };

const LOCAL_STALL_MS = 60_000;
const KEEPALIVE_MS = 10 * 60 * 1000;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2 && parts[0] && parts[1]) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function createErrorMessage(code: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (code === "agent_not_found") return t("managedPane.err.agentNotFound");
  if (code === "environment_not_found") return t("managedPane.err.environmentNotFound");
  if (code === "forbidden_scope") return t("managedPane.err.forbiddenScope");
  if (code === "enterprise_login_required") return t("managedPane.err.loginRequired");
  return t("managedPane.err.createFailed", { code: code || "unknown" });
}

function loadErrorMessage(status: number, t: (key: string) => string): string {
  if (status === 409) return t("gallery.enterprise.drawer.loginRequired");
  if (status === 404) return t("gallery.enterprise.drawer.notFound");
  return t("gallery.enterprise.drawer.loadFailed");
}

async function registerInteractive(environmentId: string): Promise<{ ok: true } | { ok: false; status: number }> {
  let token = "";
  try {
    token = (await window.agenticxDesktop.getApiAuthToken()) || "";
  } catch {
    token = "";
  }
  try {
    const response = await studioFetch("/api/enterprise-worker/interactive-environments", {
      method: "POST",
      apiToken: token,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ environment_id: environmentId }),
    });
    return response.ok ? { ok: true } : { ok: false, status: response.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

export function ManagedChatPane({ paneId, focused, onFocus }: Props): JSX.Element {
  const { t } = useTranslation("sidebar");
  const pane = useAppStore((state) => state.panes.find((item) => item.id === paneId));
  const setPaneSessionId = useAppStore((state) => state.setPaneSessionId);
  const removePane = useAppStore((state) => state.removePane);
  const userName = useAppStore((state) => state.userNickname);
  const userAvatarUrl = useAppStore((state) => state.userAvatarUrl);
  const agentId = managedAgentIdOf(pane?.avatarId);
  const [detail, setDetail] = useState<EnterpriseAgentDetail | null>(null);
  const [loadStatus, setLoadStatus] = useState<number | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingFirst, setPendingFirst] = useState<string | null>(null);
  const [lockedVersion, setLockedVersion] = useState<number | null>(null);
  const [localStall, setLocalStall] = useState(false);
  const pendingSendRef = useRef<string | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  const assistantName = detail?.agent.displayName || pane?.avatarName || "";
  const view = useManagedSession(pane?.sessionId || null, { assistantName });
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    void (async () => {
      const result = await loadEnterpriseAgentDetail(agentId, { force: reloadToken > 0 });
      if (cancelled) return;
      if (!result.ok) {
        setDetail(null);
        setLoadStatus(result.status);
        return;
      }
      setLoadStatus(null);
      setDetail(result.detail);
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId, reloadToken]);

  useEffect(() => {
    const sid = pane?.sessionId?.trim() ?? "";
    if (!sid || !agentId) return;
    let cancelled = false;
    void (async () => {
      const res = await window.agenticxDesktop.maGetSession(sid);
      if (cancelled) return;
      if (!res.ok) {
        if (res.status === 404) {
          forgetManagedSession(agentId);
          setPaneSessionId(paneId, "");
          setLockedVersion(null);
        }
        return;
      }
      const version = res.data.agent_version;
      if (typeof version === "number") setLockedVersion(version);
    })();
    return () => {
      cancelled = true;
    };
  }, [pane?.sessionId, agentId, paneId, setPaneSessionId]);

  useEffect(() => {
    const text = pendingSendRef.current;
    const sid = pane?.sessionId?.trim() ?? "";
    if (!text || !sid || !view.ready || view.transcript.sessionId !== sid) return;
    pendingSendRef.current = null;
    void deliver(text);
  }, [pane?.sessionId, view.ready, view.transcript.sessionId]);

  useEffect(() => {
    const target = detail?.agent.executionTarget;
    const environmentId = detail?.agent.defaultEnvironment?.id;
    const sid = pane?.sessionId?.trim() ?? "";
    if (target !== "desktop_worker" || !environmentId || !sid) return;
    const ping = () => {
      void registerInteractive(environmentId).then((result) => {
        if (!result.ok) console.warn("[managed-pane] interactive environment refresh failed", result.status);
      });
    };
    ping();
    const timer = window.setInterval(ping, KEEPALIVE_MS);
    return () => window.clearInterval(timer);
  }, [detail?.agent.executionTarget, detail?.agent.defaultEnvironment?.id, pane?.sessionId]);

  useEffect(() => {
    if (detail?.agent.executionTarget !== "desktop_worker" || !pane?.sessionId || view.transcript.status !== "idle") {
      setLocalStall(false);
      return;
    }
    setLocalStall(false);
    const timer = window.setTimeout(() => setLocalStall(true), LOCAL_STALL_MS);
    return () => window.clearTimeout(timer);
  }, [detail?.agent.executionTarget, pane?.sessionId, view.transcript.status, view.transcript.lastSeq]);

  useEffect(() => {
    const el = textAreaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 22 * 8)}px`;
  }, [draft]);

  async function deliver(text: string) {
    const result = await viewRef.current.sendMessage(text);
    if (!result.ok) {
      fail(result.message || createErrorMessage(result.code, t), text);
      return;
    }
    setPendingFirst(null);
  }

  function fail(message: string, text: string) {
    pendingSendRef.current = null;
    setPendingFirst(null);
    setDraft(text);
    setNotice(message);
  }

  async function runSend(text: string) {
    if (!agentId) return;
    const agent = detail?.agent;
    if (!agent) {
      fail(loadStatus != null ? loadErrorMessage(loadStatus, t) : t("gallery.enterprise.drawer.loadFailed"), text);
      return;
    }
    let sid = pane?.sessionId?.trim() ?? "";
    if (!sid) {
      if (agent.executionTarget === "desktop_worker") {
        const environmentId = agent.defaultEnvironment?.id;
        if (!environmentId) {
          fail(t("managedPane.err.noEnvironment"), text);
          return;
        }
        const registered = await registerInteractive(environmentId);
        if (!registered.ok) {
          fail(
            registered.status === 409 ? t("managedPane.err.loginRequired") : t("managedPane.err.workerStart"),
            text,
          );
          return;
        }
      }
      let created: Awaited<ReturnType<NonNullable<typeof window.agenticxDesktop.maCreateSession>>>;
      try {
        created = await window.agenticxDesktop.maCreateSession({
          agentId,
          environmentId: agent.executionTarget === "desktop_worker" ? agent.defaultEnvironment?.id : undefined,
          title: agent.displayName,
        });
      } catch {
        fail(createErrorMessage("network_error", t), text);
        return;
      }
      if (!created.ok) {
        fail(createErrorMessage(created.code, t), text);
        return;
      }
      sid = typeof created.data.id === "string" ? created.data.id : "";
      if (!sid) {
        fail(createErrorMessage("invalid_request", t), text);
        return;
      }
      if (typeof created.data.agent_version === "number") setLockedVersion(created.data.agent_version);
      pendingSendRef.current = text;
      setPaneSessionId(paneId, sid);
      rememberManagedSession(agentId, sid);
      return;
    }
    await deliver(text);
  }

  function submit() {
    const text = draft.trim();
    if (!text || loading || persistent) return;
    if (view.transcript.status === "requires_action") return;
    setDraft("");
    setNotice(null);
    if (!pane?.sessionId) setPendingFirst(text);
    void runSend(text);
  }

  const running = view.transcript.status === "running";
  const needsAction = view.transcript.status === "requires_action";
  const loading = Boolean(agentId) && !detail && loadStatus == null;
  const persistent = loadStatus != null
    ? loadErrorMessage(loadStatus, t)
    : detail?.agent.executionTarget === "desktop_worker" && !detail.agent.defaultEnvironment
      ? t("managedPane.err.noEnvironment")
      : null;
  const shownNotice = notice ?? persistent;
  const version = lockedVersion ?? detail?.agent.effectiveVersion ?? null;
  const color = resolveAvatarPaletteKey(agentId || paneId);
  const echoed = pendingFirst != null && view.messages.some((message) => message.role === "user" && message.content === pendingFirst);
  const sessionId = pane?.sessionId?.trim() ?? "";

  return (
    <div
      data-testid="managed-chat-pane"
      className="flex h-full min-h-0 min-w-0 flex-col bg-surface"
      onMouseDown={onFocus}
      data-focused={focused ? "true" : "false"}
    >
      <header className="flex items-center gap-2 border-b border-border bg-surface-panel px-3 py-2">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${avatarBgClass(color)} ${avatarFgClass(color)}`}>
          {initials(assistantName || "?")}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-medium text-text-strong">{assistantName}</span>
            <span className="rounded-md bg-surface-card-strong px-1.5 py-0.5 text-[10px] text-text-strong">
              {t("gallery.enterprise.badge")}
            </span>
            {version != null ? (
              <span className="text-xs text-text-muted">{t("gallery.enterprise.version", { version })}</span>
            ) : null}
            {detail ? (
              <span className="text-xs text-text-muted">{t(executionLabelKey(detail.agent.executionTarget))}</span>
            ) : null}
          </div>
        </div>
        <HoverTip label={t("managedPane.definition")}>
          <button
            type="button"
            aria-label={t("managedPane.definition")}
            className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text-strong"
            onClick={() => setDrawerOpen(true)}
            disabled={!agentId}
          >
            <FileText className="h-4 w-4" />
          </button>
        </HoverTip>
        <HoverTip label={t("managedPane.newChat")}>
          <button
            type="button"
            aria-label={t("managedPane.newChat")}
            className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text-strong"
            onClick={() => {
              pendingSendRef.current = null;
              setPendingFirst(null);
              setLockedVersion(null);
              setDraft("");
              setNotice(null);
              if (agentId) forgetManagedSession(agentId);
              setPaneSessionId(paneId, "");
            }}
          >
            <Sparkles className="h-4 w-4" />
          </button>
        </HoverTip>
        <button
          type="button"
          aria-label={t("managedPane.close")}
          className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text-strong"
          onClick={() => removePane(paneId)}
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      {detail?.agent.executionTarget === "desktop_worker" ? (
        <p className="border-b border-border px-3 py-1 text-xs text-text-subtle">{t("managedPane.localBanner")}</p>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1">
          {sessionId ? (
            <ManagedTranscript
              view={view}
              sessionId={sessionId}
              assistantName={assistantName}
              userName={userName}
              userAvatarUrl={userAvatarUrl}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-sm text-text-strong">
                {detail?.version.summary.welcomeMessage || t("managedPane.placeholder", { name: assistantName })}
              </p>
              {detail && detail.version.summary.suggestedQuestions.length > 0 ? (
                <div className="flex flex-wrap justify-center gap-2">
                  {detail.version.summary.suggestedQuestions.map((question) => (
                    <button
                      key={question}
                      type="button"
                      className="rounded-full border border-border bg-surface-card px-3 py-1 text-xs text-text-strong hover:bg-surface-hover"
                      onClick={() => {
                        setDraft(question);
                        setNotice(null);
                      }}
                    >
                      {question}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </div>
        {pendingFirst && !echoed ? (
          <p data-testid="pending-user" className="px-4 py-2 text-[13px] text-text-strong">{pendingFirst}</p>
        ) : null}
      </div>
      {shownNotice ? (
        <div className="flex items-center justify-center gap-1.5 px-4 py-2 text-center text-[13px] text-amber-600" role="alert">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />
          <span>{shownNotice}</span>
        </div>
      ) : null}
      {localStall ? (
        <p className="px-4 pb-1 text-center text-xs text-amber-600" role="status">{t("managedPane.localStall")}</p>
      ) : null}
      <div className="border-t border-border p-3">
        {loadStatus != null && loadStatus !== 409 && loadStatus !== 404 ? (
          <div className="mb-2 flex justify-center">
            <button
              type="button"
              className="text-xs text-text-muted underline"
              onClick={() => setReloadToken((value) => value + 1)}
            >
              {t("gallery.enterprise.drawer.retry")}
            </button>
          </div>
        ) : null}
        <div className="flex items-end gap-2">
          <textarea
            ref={textAreaRef}
            rows={1}
            value={draft}
            disabled={loading || Boolean(persistent)}
            placeholder={needsAction
              ? t("managedPane.requiresAction")
              : t("managedPane.placeholder", { name: assistantName })}
            className="max-h-44 min-h-[40px] flex-1 resize-none rounded-xl border border-border bg-surface-card px-3 py-2 text-sm text-text-strong outline-none placeholder:text-text-faint disabled:opacity-60"
            onChange={(event) => {
              setDraft(event.target.value);
              setNotice(null);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey) return;
              event.preventDefault();
              if (running) {
                void view.interrupt();
                return;
              }
              submit();
            }}
          />
          <button
            type="button"
            disabled={!running && (loading || Boolean(persistent) || needsAction || draft.trim().length === 0)}
            className="rounded-md bg-[var(--ui-btn-primary-bg)] px-3 py-2 text-[13px] font-medium text-[var(--ui-btn-primary-text)] hover:bg-[var(--ui-btn-primary-bg-hover)] disabled:opacity-50"
            onClick={() => {
              if (running) {
                void view.interrupt();
                return;
              }
              submit();
            }}
          >
            {running ? t("managedPane.stop") : t("managedPane.send")}
          </button>
        </div>
      </div>
      {drawerOpen && agentId ? <EnterpriseAgentDrawer agentId={agentId} onClose={() => setDrawerOpen(false)} /> : null}
    </div>
  );
}
