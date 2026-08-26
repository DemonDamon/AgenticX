import { useCallback, useEffect, useState } from "react";
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

export function WorkspaceIsolationPanel() {
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
          setMessage(e instanceof Error ? e.message : "读取工作区隔离状态失败。");
        }
      } finally {
        if (!disposed) setLoading(false);
      }
    };
    void load();
    return () => {
      disposed = true;
    };
  }, [fetchStatus]);

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
      setMessage("已保存工作区隔离档位。");
    } catch (e) {
      setTier(prev);
      setMessageTone("err");
      setMessage(e instanceof Error ? e.message : "保存工作区隔离档位失败。");
    } finally {
      setBusy(false);
    }
  };

  const current = SANDBOX_TIER_OPTIONS.find((option) => option.value === tier) ?? SANDBOX_TIER_OPTIONS[1]!;

  return (
    <Panel title="工作区隔离">
      {loading ? (
        <div className="py-2 text-sm text-text-faint">加载中…</div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-6">
            <div className="min-w-0">
              <div className={SETTINGS_LABEL_CLASS}>命令沙箱档位</div>
              <p className={`mt-0.5 ${SETTINGS_HINT_CLASS}`}>{current.description}</p>
            </div>
            <SettingsDropdown
              value={tier}
              displayLabel={current.label}
              options={SANDBOX_TIER_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
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
                {notice.text}
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
