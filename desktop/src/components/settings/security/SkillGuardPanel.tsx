import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Panel } from "../../ds/Panel";
import { SettingsDropdown } from "../../ds/SettingsDropdown";
import { SettingsSwitch } from "../SettingsSwitch";
import { useAppStore } from "../../../store";
import { buildGuardFixPrompt, type GuardFixScanItem } from "../../../utils/guard-fix-prompt";
import { META_AGENT_DISPLAY_NAME } from "../../../constants/branding";
import { useTrinityConfig } from "../trinity-config";
import { SETTINGS_HINT_CLASS, SETTINGS_LABEL_CLASS } from "../../ds/settings-typography";
import { i18n } from "../../../i18n/i18n";

function st(key: string, opts?: Record<string, unknown>): string {
  return String(i18n.t(key, { ns: "settings", ...(opts ?? {}) }));
}


type GuardScanItem = {
  skill_name: string;
  verdict: string;
  score?: number;
  grade?: string;
  tier?: string;
  source?: string;
  base_dir?: string;
  can_fix?: boolean;
  ignored?: boolean;
  findings?: Array<{
    pattern_name: string;
    severity?: string;
    matched_text?: string;
    file_path?: string;
    line_number?: number;
    category?: string;
  }>;
};

type SkillScanCustomRow = { path: string; enabled: boolean };

function normalizeSkillScanCustomPaths(
  raw: Array<string | SkillScanCustomRow> | undefined | null,
): SkillScanCustomRow[] {
  if (!Array.isArray(raw)) return [];
  const out: SkillScanCustomRow[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item === "string") {
      const path = item.trim();
      if (!path || seen.has(path)) continue;
      seen.add(path);
      out.push({ path, enabled: true });
      continue;
    }
    if (item && typeof item === "object") {
      const path = String(item.path ?? "").trim();
      if (!path || seen.has(path)) continue;
      seen.add(path);
      out.push({ path, enabled: item.enabled !== false });
    }
  }
  return out;
}

function useSkillInstallPolicy() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [nonHighRiskAutoInstall, setNonHighRiskAutoInstall] = useState(true);
  const [lastSaved, setLastSaved] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      setLoading(true);
      setMessage("");
      try {
        const result = await window.agenticxDesktop.loadSkillInstallPolicy();
        if (!disposed && result?.ok && result.config) {
          const v = Boolean(result.config.non_high_risk_auto_install);
          setNonHighRiskAutoInstall(v);
          setLastSaved(v);
        } else if (!disposed) {
          setMessage(result?.error ? String(result.error) : st("security.policyLoadFailed"));
        }
      } catch {
        if (!disposed) setMessage(st("security.policyLoadFailed"));
      } finally {
        if (!disposed) setLoading(false);
      }
    };
    void load();
    return () => {
      disposed = true;
    };
  }, []);

  const updatePolicy = useCallback(async (next: boolean) => {
    setNonHighRiskAutoInstall(next);
    setSaving(true);
    setMessage("");
    try {
      const result = await window.agenticxDesktop.saveSkillInstallPolicy({
        non_high_risk_auto_install: next,
      });
      if (!result?.ok) {
        setNonHighRiskAutoInstall(lastSaved);
        setMessage(result?.error ? String(result.error) : st("security.saveFailed"));
        return;
      }
      setLastSaved(next);
      setMessage(st("security.policySaved"));
    } catch (e) {
      setNonHighRiskAutoInstall(lastSaved);
      setMessage(e instanceof Error ? e.message : st("security.saveFailed"));
    } finally {
      setSaving(false);
    }
  }, [lastSaved]);

  return { loading, saving, nonHighRiskAutoInstall, message, updatePolicy };
}

function useGuardSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState(1);
  const [scanMode, setScanMode] = useState("standard");
  const [message, setMessage] = useState("");
  const [scanBusy, setScanBusy] = useState(false);
  const [scanResults, setScanResults] = useState<GuardScanItem[]>([]);
  const [ignoredSkills, setIgnoredSkills] = useState<string[]>([]);
  const [scanned, setScanned] = useState(false);
  const [scanMsg, setScanMsg] = useState("");
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [snapshotMap, setSnapshotMap] = useState<Record<string, { id: string; ts: string }>>({});
  const [restoreMsg, setRestoreMsg] = useState("");

  const refreshSnapshotsFor = useCallback(async (items: GuardScanItem[]) => {
    const fixable = items.filter((r) => r.can_fix && r.base_dir?.trim());
    if (fixable.length === 0) return;
    const entries = await Promise.all(
      fixable.map(async (r) => {
        try {
          const res = await window.agenticxDesktop.skillSnapshotsList({
            base_dir: r.base_dir!.trim(),
          });
          if (res?.ok && res.snapshots?.length) {
            const latest = res.snapshots[0];
            return [r.skill_name, { id: latest.id, ts: latest.ts }] as const;
          }
        } catch {
          /* ignore per-skill list errors */
        }
        return null;
      }),
    );
    const next: Record<string, { id: string; ts: string }> = {};
    for (const row of entries) {
      if (row) next[row[0]] = row[1];
    }
    if (Object.keys(next).length > 0) {
      setSnapshotMap((prev) => ({ ...prev, ...next }));
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      setLoading(true);
      try {
        const result = await window.agenticxDesktop.getGuardSettings();
        if (!disposed && result?.ok) {
          if (typeof result.version === "number") setVersion(result.version);
          if (result.scan_mode) setScanMode(result.scan_mode);
          if (Array.isArray(result.ignored)) setIgnoredSkills(result.ignored);
        }
      } catch {
        if (!disposed) setMessage(st("security.scanConfigLoadFailed"));
      } finally {
        if (!disposed) setLoading(false);
      }
    };
    void load();
    return () => {
      disposed = true;
    };
  }, []);

  const saveGuard = useCallback(async (next: { version?: number; scan_mode?: string }) => {
    setSaving(true);
    setMessage("");
    try {
      const result = await window.agenticxDesktop.putGuardSettings(next);
      if (!result?.ok) {
        setMessage(result?.error ? String(result.error) : st("security.saveFailed"));
        return;
      }
      if (typeof result.version === "number") setVersion(result.version);
      if (result.scan_mode) setScanMode(result.scan_mode);
      setMessage(st("security.scanConfigSaved"));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : st("security.saveFailed"));
    } finally {
      setSaving(false);
    }
  }, []);

  const runScanAll = useCallback(async () => {
    setScanBusy(true);
    setScanMsg("");
    try {
      const result = await window.agenticxDesktop.guardScanAll({});
      if (!result?.ok) {
        setScanMsg(result?.error ? String(result.error) : st("security.scanFailed"));
        return;
      }
      const rows = Array.isArray(result.results) ? result.results : [];
      setScanResults(rows);
      if (Array.isArray(result.ignored)) setIgnoredSkills(result.ignored);
      setScanned(true);
      void refreshSnapshotsFor(rows);
    } catch (e) {
      setScanMsg(e instanceof Error ? e.message : st("security.scanFailed"));
    } finally {
      setScanBusy(false);
    }
  }, [refreshSnapshotsFor]);

  const restoreSnapshot = useCallback(
    async (item: GuardScanItem) => {
      const meta = snapshotMap[item.skill_name];
      const base = item.base_dir?.trim();
      if (!base || !meta?.id) {
        setRestoreMsg(st("security.noBackup"));
        return;
      }
      setRestoreMsg("");
      setActionBusy(item.skill_name);
      try {
        const res = await window.agenticxDesktop.skillSnapshotRestore({
          base_dir: base,
          snapshot_id: meta.id,
        });
        if (!res?.ok) {
          setRestoreMsg(res?.error ? String(res.error) : st("security.restoreFailed"));
          return;
        }
        setRestoreMsg(st("security.restoredBackup", { ts: formatGuardSnapshotTs(meta.ts) }));
        const scan = await window.agenticxDesktop.guardScanAll({});
        if (scan?.ok) {
          const rows = Array.isArray(scan.results) ? scan.results : [];
          setScanResults(rows);
          if (Array.isArray(scan.ignored)) setIgnoredSkills(scan.ignored);
          void refreshSnapshotsFor(rows);
        }
      } catch (e) {
        setRestoreMsg(e instanceof Error ? e.message : st("security.restoreFailed"));
      } finally {
        setActionBusy(null);
      }
    },
    [refreshSnapshotsFor, snapshotMap],
  );

  const ignoreSkill = useCallback(async (name: string) => {
    setActionBusy(name);
    try {
      const result = await window.agenticxDesktop.putGuardSettings({ add_ignore: name });
      if (result?.ok && Array.isArray(result.ignored)) setIgnoredSkills(result.ignored);
      setScanResults((prev) => prev.filter((r) => r.skill_name !== name));
    } finally {
      setActionBusy(null);
    }
  }, []);

  const unignoreSkill = useCallback(async (name: string) => {
    setActionBusy(name);
    try {
      const result = await window.agenticxDesktop.putGuardSettings({ remove_ignore: name });
      if (result?.ok && Array.isArray(result.ignored)) setIgnoredSkills(result.ignored);
    } finally {
      setActionBusy(null);
    }
  }, []);

  const disableSkill = useCallback(async (name: string) => {
    setActionBusy(name);
    try {
      const settings = await window.agenticxDesktop.getSkillSettings();
      const presetPaths = Array.isArray(settings?.preset_paths)
        ? settings.preset_paths.map((p) => ({ id: p.id, enabled: p.enabled }))
        : [];
      const customPaths = normalizeSkillScanCustomPaths(
        Array.isArray(settings?.custom_paths) ? settings.custom_paths : [],
      );
      const preferredSources =
        settings?.preferred_sources && typeof settings.preferred_sources === "object"
          ? settings.preferred_sources
          : {};
      const current = Array.isArray(settings?.disabled_skills) ? settings.disabled_skills : [];
      const nextDisabled = current.includes(name) ? current : [...current, name];
      await window.agenticxDesktop.putSkillSettings({
        presetPaths,
        customPaths,
        preferredSources,
        disabledSkills: nextDisabled,
      });
      setScanResults((prev) => prev.filter((r) => r.skill_name !== name));
    } finally {
      setActionBusy(null);
    }
  }, []);

  return {
    loading,
    saving,
    version,
    scanMode,
    message,
    scanBusy,
    scanResults,
    ignoredSkills,
    scanned,
    scanMsg,
    actionBusy,
    saveGuard,
    runScanAll,
    ignoreSkill,
    unignoreSkill,
    disableSkill,
    snapshotMap,
    restoreMsg,
    restoreSnapshot,
    setSnapshotMap,
  };
}

const GUARD_PATTERN_LABELS: Record<string, string> = {
  exfiltration_curl: st("skills.scan.patterns.exfiltration_curl"),
  exfiltration_wget: st("skills.scan.patterns.exfiltration_wget"),
  exfiltration_fetch_env: st("skills.scan.patterns.exfiltration_fetch_env"),
  credential_ssh: st("skills.scan.patterns.credential_ssh"),
  credential_dotenv: st("skills.scan.patterns.credential_dotenv"),
  credential_word: st("skills.scan.patterns.credential_word"),
  prompt_ignore_previous: st("skills.scan.patterns.prompt_ignore_previous"),
  prompt_system: st("skills.scan.patterns.prompt_system"),
  prompt_system_tag: st("skills.scan.patterns.prompt_system_tag"),
  destructive_rm: st("skills.scan.patterns.destructive_rm"),
  destructive_chmod: st("skills.scan.patterns.destructive_chmod"),
  destructive_sql: st("skills.scan.patterns.destructive_sql"),
  curl_pipe_shell: st("skills.scan.patterns.curl_pipe_shell"),
  reverse_shell: st("skills.scan.patterns.reverse_shell"),
  invisible_unicode: st("skills.scan.patterns.invisible_unicode"),
  suspicious_url: st("skills.scan.patterns.suspicious_url"),
  typosquat_dependency: st("skills.scan.patterns.typosquat_dependency"),
  dynamic_download_l2: st("skills.scan.patterns.dynamic_download_l2"),
  base64_decode_pipe: st("skills.scan.patterns.base64_decode_pipe"),
};
const GUARD_PATTERN_LABEL_HIGH_ENTROPY = "high_entropy_secret";

function guardVerdictLabel(v: string): string {
  return v === "dangerous"
    ? st("skills.scan.verdictDanger")
    : v === "caution"
      ? st("skills.scan.verdictCaution")
      : st("skills.scan.verdictOk");
}

function msgStartsWithKey(msg: string, key: string, opts?: Record<string, unknown>): boolean {
  const sample = st(key, opts);
  const cut = sample.search(/[（(]/);
  const prefix = (cut > 0 ? sample.slice(0, cut) : sample).trim();
  return Boolean(prefix) && msg.startsWith(prefix);
}

function formatGuardSnapshotTs(ts: string): string {
  const idMatch = ts.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
  if (idMatch) {
    return `${idMatch[1]}-${idMatch[2]}-${idMatch[3]} ${idMatch[4]}:${idMatch[5]}:${idMatch[6]} UTC`;
  }
  return ts;
}

function GuardScanResultCard({
  item,
  busy,
  aiFixDisabled,
  onAiFix,
  hasSnapshot,
  onRestore,
  onDisable,
  onIgnore,
}: {
  item: GuardScanItem;
  busy: boolean;
  aiFixDisabled?: boolean;
  onAiFix?: () => void;
  hasSnapshot?: boolean;
  onRestore?: () => void;
  onDisable: () => void;
  onIgnore: () => void;
}) {
  const dangerous = item.verdict === "dangerous";
  const findings = item.findings ?? [];
  return (
    <div className="rounded-xl border border-border bg-surface-card px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="truncate text-sm font-medium text-text-primary">{item.skill_name}</span>
        <span
          className={`shrink-0 rounded-full px-1.5 text-[10px] ${
            dangerous
              ? "border border-rose-500/35 bg-rose-500/10 text-rose-300"
              : "border border-amber-500/35 bg-amber-500/10 text-amber-300"
          }`}
        >
          {guardVerdictLabel(item.verdict)}
        </span>
        {!item.can_fix ? (
          <span className="shrink-0 rounded-full border border-border bg-surface-panel px-1.5 text-[10px] text-text-faint">
            {st("security.external")}
          </span>
        ) : null}
        <span className="ml-auto text-[11px] text-text-faint">
          {[item.grade ? st("security.grade", { grade: item.grade }) : "", typeof item.score === "number" ? st("security.score", { score: item.score }) : "", item.tier]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>
      {findings.length > 0 ? (
        <ul className="mt-2 space-y-0.5 text-[11px] text-text-subtle">
          {findings.slice(0, 5).map((f, i) => (
            <li key={`${item.skill_name}-f-${i}`} className="flex gap-1.5">
              <span className={f.severity === "dangerous" ? "text-rose-400" : "text-amber-400"}>
                {f.severity === "dangerous" ? "⛔" : "⚠"}
              </span>
              <span className="min-w-0">
                {GUARD_PATTERN_LABELS[f.pattern_name] ||
                  (f.pattern_name === GUARD_PATTERN_LABEL_HIGH_ENTROPY
                    ? st("security.highEntropy")
                    : f.pattern_name)}
                {f.matched_text ? (
                  <span className="text-text-faint">：「{f.matched_text.slice(0, 50)}」</span>
                ) : null}
              </span>
            </li>
          ))}
          {findings.length > 5 ? (
            <li className="text-text-faint">{st("security.moreFindings", { count: findings.length - 5 })}</li>
          ) : null}
        </ul>
      ) : null}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {item.can_fix ? (
          <button
            type="button"
            className="rounded-md border border-[var(--settings-accent-border-strong)] bg-[var(--settings-accent-subtle-bg)] px-2.5 py-1 text-xs text-[var(--settings-accent-fg-muted)] transition hover:bg-[var(--settings-accent-subtle-bg-hover)] disabled:opacity-50"
            disabled={busy || !onAiFix || aiFixDisabled}
            title={
              aiFixDisabled
                ? st("security.needEnableManage")
                : st("security.aiFixHint")
            }
            onClick={onAiFix}
          >
            {st("security.aiFix")}
          </button>
        ) : (
          <span className="text-[11px] text-text-faint">{st("security.externalReadonly")}</span>
        )}
        {item.can_fix && hasSnapshot ? (
          <button
            type="button"
            className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-300 transition hover:bg-amber-500/15 disabled:opacity-50"
            disabled={busy || !onRestore}
            title={st("security.restoreBackupTitle")}
            onClick={onRestore}
          >
            {st("security.restoreBackup")}
          </button>
        ) : null}
        <button
          type="button"
          className="rounded-md border border-border px-2.5 py-1 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
          disabled={busy}
          title={st("security.disableTitle")}
          onClick={onDisable}
        >
          {st("security.disable")}
        </button>
        <button
          type="button"
          className="rounded-md border border-border px-2.5 py-1 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
          disabled={busy}
          title={st("security.ignoreTitle")}
          onClick={onIgnore}
        >
          {st("security.ignore")}
        </button>
      </div>
    </div>
  );
}

function SettingsToggleCard(props: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  const { title, description, checked, disabled, onChange } = props;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-card px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <div className={SETTINGS_LABEL_CLASS}>{title}</div>
        <p className={`mt-1 ${SETTINGS_HINT_CLASS}`}>{description}</p>
      </div>
      <SettingsSwitch
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        aria-label={title}
      />
    </div>
  );
}

export function SkillGuardPanel() {
  const { t } = useTranslation("settings");
  const { form } = useTrinityConfig();
  const {
    loading: policyLoading,
    saving: policySaving,
    nonHighRiskAutoInstall,
    message: policyMessage,
    updatePolicy,
  } = useSkillInstallPolicy();
  const {
    loading: guardLoading,
    saving: guardSaving,
    version: guardVersion,
    scanMode,
    message: guardMessage,
    scanBusy,
    scanResults,
    ignoredSkills,
    scanned,
    scanMsg,
    actionBusy,
    saveGuard,
    runScanAll,
    ignoreSkill,
    unignoreSkill,
    disableSkill,
    snapshotMap,
    restoreMsg,
    restoreSnapshot,
    setSnapshotMap,
  } = useGuardSettings();

  const addPane = useAppStore((s) => s.addPane);
  const setForwardAutoReply = useAppStore((s) => s.setForwardAutoReply);
  const closeSettings = useAppStore((s) => s.closeSettings);

  const loading = policyLoading || guardLoading;
  const busy = policySaving || guardSaving;
  const [guardFixBusy, setGuardFixBusy] = useState(false);
  const [guardFixMsg, setGuardFixMsg] = useState("");

  const runGuardFixInMetaAgent = useCallback(
    async (item: GuardFixScanItem) => {
      if (!form.skill_manage_enabled) {
        setGuardFixMsg(st("security.enableManageFirst"));
        return;
      }
      const prompt = buildGuardFixPrompt(item);
      if (!prompt.trim()) {
        setGuardFixMsg(st("security.missingSkillDir"));
        return;
      }
      setGuardFixMsg("");
      setGuardFixBusy(true);
      try {
        const base = item.base_dir?.trim();
        if (base) {
          const snap = await window.agenticxDesktop.skillSnapshot({
            base_dir: base,
            trigger: "guard_ai_fix",
            skill_name: item.skill_name,
          });
          if (snap?.ok && snap.snapshot_id) {
            setSnapshotMap((prev) => ({
              ...prev,
              [item.skill_name]: {
                id: snap.snapshot_id!,
                ts: snap.timestamp ?? snap.snapshot_id!,
              },
            }));
          } else if (snap?.error) {
            setGuardFixMsg(st("security.backupSkipped", { error: snap.error }));
          }
        }
        const created = await window.agenticxDesktop.createSession({});
        if (!created.ok || !created.session_id) {
          setGuardFixMsg(created.error ?? st("security.createMetaFailed"));
          return;
        }
        const sid = created.session_id;
        const paneId = addPane(null, META_AGENT_DISPLAY_NAME, sid);
        setForwardAutoReply({ paneId, sessionId: sid, text: prompt });
        closeSettings();
      } catch (e) {
        setGuardFixMsg(e instanceof Error ? e.message : String(e));
      } finally {
        setGuardFixBusy(false);
      }
    },
    [addPane, closeSettings, form.skill_manage_enabled, setForwardAutoReply, setSnapshotMap],
  );

  if (loading) {
    return (
      <Panel title={st("security.skillGuardTitle")}>
        <div className="py-2 text-sm text-text-faint">{st("security.loading")}</div>
      </Panel>
    );
  }

  return (
    <Panel title={st("security.skillGuardTitle")}>
      <div className="space-y-3">
        <SettingsToggleCard
          title={st("security.autoInstallTitle")}
          description={st("security.autoInstallDesc")}
          checked={nonHighRiskAutoInstall}
          disabled={busy}
          onChange={(next) => void updatePolicy(next)}
        />
        <div className="rounded-xl border border-border bg-surface-card px-4 py-3.5">
          <div className={SETTINGS_LABEL_CLASS}>{st("security.scanTitle")}</div>
          <div className={`mt-1 space-y-1 ${SETTINGS_HINT_CLASS}`}>
            <p>{st("security.scanIntro")}</p>
            <p>{st("security.engineV1")} {st("security.engineV2")}</p>
            <p>{st("security.scanModeHint")}</p>
          </div>
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <span className="shrink-0 text-xs text-text-muted">{st("security.engineVersion")}</span>
              <SettingsDropdown
                value={String(guardVersion)}
                displayLabel={`v${guardVersion}`}
                options={[
                  { value: "1", label: "v1" },
                  { value: "2", label: "v2" },
                ]}
                onChange={(v) => void saveGuard({ version: Number(v) })}
                disabled={busy}
                size="compact"
                menuPortal
                className="w-[7rem] shrink-0"
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="shrink-0 text-xs text-text-muted">{st("security.scanMode")}</span>
              <SettingsDropdown
                value={scanMode}
                displayLabel={
                  scanMode === "quick"
                    ? st("security.modeQuick")
                    : scanMode === "full"
                      ? st("security.modeFull")
                      : st("security.modeStandard")
                }
                options={[
                  { value: "quick", label: st("security.modeQuick") },
                  { value: "standard", label: st("security.modeStandard") },
                  { value: "full", label: st("security.modeFull") },
                ]}
                onChange={(v) => void saveGuard({ scan_mode: v })}
                disabled={busy || guardVersion < 2}
                size="compact"
                menuPortal
                className="w-[7rem] shrink-0"
                title={guardVersion < 2 ? st("security.modeV2Only") : undefined}
              />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-3 border-t border-border pt-3">
            <button
              type="button"
              className="rounded-md bg-btnPrimary px-3 py-1.5 text-xs font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover disabled:opacity-50"
              disabled={scanBusy}
              onClick={() => void runScanAll()}
            >
              {scanBusy ? st("security.scanning") : st("security.scanInstalled")}
            </button>
            <span className="text-[11px] text-text-faint">
              {st("security.scanInstalledHint")}
            </span>
          </div>
          {guardMessage ? (
            <div className={`mt-2 text-xs ${guardMessage === st("security.scanConfigSaved") ? "text-text-muted" : "text-rose-400"}`}>
              {guardMessage}
            </div>
          ) : null}
          {scanMsg ? <div className="mt-2 text-xs text-rose-400">{scanMsg}</div> : null}
          {guardFixMsg ? (
            <div
              className={`mt-2 text-xs ${guardFixMsg === st("security.enableManageFirst") || guardFixMsg === st("security.needEnableManage") || msgStartsWithKey(guardFixMsg, "security.backupSkipped", { error: "" }) ? "text-amber-400" : "text-rose-400"}`}
            >
              {guardFixMsg}
            </div>
          ) : null}
          {restoreMsg ? (
            <div
              className={`mt-2 text-xs ${msgStartsWithKey(restoreMsg, "security.restoredBackup", { ts: "" }) ? "text-emerald-400" : "text-rose-400"}`}
            >
              {restoreMsg}
            </div>
          ) : null}
          {scanned && !scanBusy ? (
            scanResults.length === 0 ? (
              <div className="mt-3 rounded-md border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-400">
                {st("security.noRisky")}
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                {scanResults.map((r) => (
                  <GuardScanResultCard
                    key={r.skill_name}
                    item={r}
                    busy={actionBusy === r.skill_name || guardFixBusy}
                    aiFixDisabled={!form.skill_manage_enabled}
                    onAiFix={
                      r.can_fix
                        ? () => void runGuardFixInMetaAgent(r)
                        : undefined
                    }
                    hasSnapshot={Boolean(r.can_fix && snapshotMap[r.skill_name]?.id)}
                    onRestore={
                      r.can_fix && snapshotMap[r.skill_name]?.id
                        ? () => void restoreSnapshot(r)
                        : undefined
                    }
                    onDisable={() => void disableSkill(r.skill_name)}
                    onIgnore={() => void ignoreSkill(r.skill_name)}
                  />
                ))}
              </div>
            )
          ) : null}
          {ignoredSkills.length > 0 ? (
            <div className="mt-3 border-t border-border pt-3">
              <div className="text-[11px] text-text-faint">{st("security.ignored")}</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {ignoredSkills.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-panel px-2 py-0.5 text-[11px] text-text-muted transition hover:text-text-primary disabled:opacity-50"
                    disabled={actionBusy === name}
                    title={st("security.undoIgnore")}
                    onClick={() => void unignoreSkill(name)}
                  >
                    {name}
                    <span className="text-text-faint">✕</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      {policyMessage ? (
        <div
          className={`mt-2 text-xs ${policyMessage === st("security.policySaved") ? "text-text-muted" : "text-rose-400"}`}
        >
          {policyMessage}
        </div>
      ) : null}
    </Panel>
  );
}
