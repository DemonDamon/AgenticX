import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Panel } from "../../ds/Panel";
import { SETTINGS_HINT_CLASS, SETTINGS_LABEL_CLASS } from "../../ds/settings-typography";
import { SettingsDropdown } from "../../ds/SettingsDropdown";
import { useAppStore } from "../../../store";
import {
  SANDBOX_TIER_OPTIONS,
  normalizeSandboxTier,
  sandboxNotices,
  type SandboxTier,
} from "../../../utils/sandbox-status";

const TIER_LABEL_KEY: Record<SandboxTier, string> = {
  "read-only": "security.tierReadOnly",
  "workspace-write": "security.tierWorkspace",
  "danger-full-access": "security.tierDanger",
};

const TIER_DESC_KEY: Record<SandboxTier, string> = {
  "read-only": "security.tierReadOnlyDesc",
  "workspace-write": "security.tierWorkspaceDesc",
  "danger-full-access": "security.tierDangerDesc",
};

const NOTICE_TEXT_KEY: Record<string, string> = {
  "shell-read-full": "security.noticeShellFull",
  "shell-read-none": "security.noticeShellNone",
  "shell-read-unknown": "security.noticeShellUnknown",
  "path-deny-full": "security.noticeDenyFull",
  "path-deny-partial": "security.noticeDenyPartial",
  "path-deny-unknown": "security.noticeDenyUnknown",
};

export function WorkspaceIsolationPanel() {
  const { t } = useTranslation("settings");
  const apiToken = useAppStore((s) => s.apiToken);
  const backendUrl = useAppStore((s) => s.backendUrl);
  const [tier, setTier] = useState<SandboxTier>("workspace-write");
  const [notices, setNotices] = useState(sandboxNotices({}));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"ok" | "err">("ok");

  const resolveApiBase = useCallback(async () => {
    const u = (backendUrl ?? "").trim();
    if (u) return u.replace(/\/+$/, "");
    const raw = String((await window.agenticxDesktop.getApiBase()) || "").trim();
    return raw.replace(/\/+$/, "");
  }, [backendUrl]);

  const applyPayload = useCallback((data: Record<string, unknown>) => {
    setTier(normalizeSandboxTier(data.command_permissions));
    setNotices(
      sandboxNotices({
        shellReadIsolation: data.shell_read_isolation,
        pathDenyEnforcement: data.path_deny_enforcement,
      }),
    );
  }, []);

  const fetchStatus = useCallback(async () => {
    const headers: Record<string, string> = {};
    if (apiToken) headers["x-agx-desktop-token"] = apiToken;
    const base = await resolveApiBase();
    const res = await fetch(`${base}/api/permissions`, { headers });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok || data.ok === false) {
      throw new Error(
        (typeof data.detail === "string" && data.detail) ||
          (typeof data.error === "string" && data.error) ||
          `HTTP ${res.status}`,
      );
    }
    applyPayload(data);
  }, [apiToken, applyPayload, resolveApiBase]);

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      setLoading(true);
      setMessage("");
      try {
        await fetchStatus();
      } catch (e) {
        if (!disposed) {
          setNotices(sandboxNotices({}));
          setMessageTone("err");
          setMessage(e instanceof Error ? e.message : t("security.isolationLoadFailed"));
        }
      } finally {
        if (!disposed) setLoading(false);
      }
    };
    void load();
    return () => {
      disposed = true;
    };
  }, [fetchStatus, t]);

  const persistTier = async (next: SandboxTier) => {
    const prev = tier;
    setTier(next);
    setBusy(true);
    setMessage("");
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiToken) headers["x-agx-desktop-token"] = apiToken;
      const base = await resolveApiBase();
      const res = await fetch(`${base}/api/permissions`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ command_permissions: next }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || data.ok === false) {
        setTier(prev);
        setMessageTone("err");
        setMessage(
          (typeof data.detail === "string" && data.detail) ||
            (typeof data.error === "string" && data.error) ||
            `HTTP ${res.status}`,
        );
        return;
      }
      applyPayload(data);
      setMessageTone("ok");
      setMessage(t("security.isolationSaved"));
    } catch (e) {
      setTier(prev);
      setMessageTone("err");
      setMessage(e instanceof Error ? e.message : t("security.isolationSaveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const current = SANDBOX_TIER_OPTIONS.find((option) => option.value === tier) ?? SANDBOX_TIER_OPTIONS[1]!;

  return (
    <Panel title={t("security.isolationTitle")}>
      {loading ? (
        <div className="py-2 text-sm text-text-faint">{t("security.loading")}</div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-6">
            <div className="min-w-0">
              <div className={SETTINGS_LABEL_CLASS}>{t("security.sandboxTier")}</div>
              <p className={`mt-0.5 ${SETTINGS_HINT_CLASS}`}>{t(TIER_DESC_KEY[current.value])}</p>
            </div>
            <SettingsDropdown
              value={tier}
              displayLabel={t(TIER_LABEL_KEY[current.value])}
              options={SANDBOX_TIER_OPTIONS.map((option) => ({
                value: option.value,
                label: t(TIER_LABEL_KEY[option.value]),
              }))}
              onChange={(next) => void persistTier(normalizeSandboxTier(next))}
              disabled={busy}
              className="w-52 shrink-0"
              size="compact"
              menuPortal
            />
          </div>
          <ul className="space-y-1.5">
            {notices.map((notice) => (
              <li
                key={notice.id}
                className={`text-xs leading-5 ${
                  notice.tone === "warn" ? "text-status-warning" : "text-text-faint"
                }`}
              >
                {NOTICE_TEXT_KEY[notice.id] ? t(NOTICE_TEXT_KEY[notice.id]) : notice.text}
              </li>
            ))}
          </ul>
          {message ? (
            <div className={`text-xs ${messageTone === "ok" ? "text-text-muted" : "text-rose-400"}`}>
              {message}
            </div>
          ) : null}
        </div>
      )}
    </Panel>
  );
}
