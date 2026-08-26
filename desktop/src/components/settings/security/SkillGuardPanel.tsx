import { useCallback, useEffect, useState } from "react";
import { Panel } from "../../ds/Panel";
import { SettingsDropdown } from "../../ds/SettingsDropdown";
import { SettingsSwitch } from "../SettingsSwitch";
import { useAppStore } from "../../../store";
import { buildGuardFixPrompt, type GuardFixScanItem } from "../../../utils/guard-fix-prompt";
import { META_AGENT_DISPLAY_NAME } from "../../../constants/branding";
import { useTrinityConfig } from "../trinity-config";

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
          setMessage(result?.error ? String(result.error) : "读取技能安装策略失败。");
        }
      } catch {
        if (!disposed) setMessage("读取技能安装策略失败。");
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
        setMessage(result?.error ? String(result.error) : "保存失败。");
        return;
      }
      setLastSaved(next);
      setMessage("已保存。之后装扩展包或从 ClawHub 安装的技能时，是否跳过确认由本开关与安装前扫描结果一起决定（与后端共用同一份配置）。");
    } catch (e) {
      setNonHighRiskAutoInstall(lastSaved);
      setMessage(e instanceof Error ? e.message : "保存失败。");
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
        if (!disposed) setMessage("读取安全扫描配置失败。");
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
        setMessage(result?.error ? String(result.error) : "保存失败。");
        return;
      }
      if (typeof result.version === "number") setVersion(result.version);
      if (result.scan_mode) setScanMode(result.scan_mode);
      setMessage("已保存安全扫描配置。");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "保存失败。");
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
        setScanMsg(result?.error ? String(result.error) : "扫描失败。");
        return;
      }
      const rows = Array.isArray(result.results) ? result.results : [];
      setScanResults(rows);
      if (Array.isArray(result.ignored)) setIgnoredSkills(result.ignored);
      setScanned(true);
      void refreshSnapshotsFor(rows);
    } catch (e) {
      setScanMsg(e instanceof Error ? e.message : "扫描失败。");
    } finally {
      setScanBusy(false);
    }
  }, [refreshSnapshotsFor]);

  const restoreSnapshot = useCallback(
    async (item: GuardScanItem) => {
      const meta = snapshotMap[item.skill_name];
      const base = item.base_dir?.trim();
      if (!base || !meta?.id) {
        setRestoreMsg("无可用的修复前备份。");
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
          setRestoreMsg(res?.error ? String(res.error) : "恢复失败。");
          return;
        }
        setRestoreMsg(`已恢复到修复前备份（${formatGuardSnapshotTs(meta.ts)}）。`);
        const scan = await window.agenticxDesktop.guardScanAll({});
        if (scan?.ok) {
          const rows = Array.isArray(scan.results) ? scan.results : [];
          setScanResults(rows);
          if (Array.isArray(scan.ignored)) setIgnoredSkills(scan.ignored);
          void refreshSnapshotsFor(rows);
        }
      } catch (e) {
        setRestoreMsg(e instanceof Error ? e.message : "恢复失败。");
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
  exfiltration_curl: "数据外泄（curl）",
  exfiltration_wget: "数据外泄（wget）",
  exfiltration_fetch_env: "读取环境变量并上传",
  credential_ssh: "访问 SSH 密钥",
  credential_dotenv: "引用 .env 文件",
  credential_word: "涉及凭据/密码关键词",
  prompt_ignore_previous: "提示词注入（忽略先前指令）",
  prompt_system: "提示词注入（system prompt）",
  prompt_system_tag: "提示词注入（<system> 标签）",
  destructive_rm: "破坏性操作（rm -rf /）",
  destructive_chmod: "破坏性操作（chmod 777）",
  destructive_sql: "破坏性操作（DROP TABLE）",
  curl_pipe_shell: "远程脚本管道执行",
  reverse_shell: "反向 Shell",
  invisible_unicode: "不可见 Unicode 字符",
  suspicious_url: "可疑外发 URL",
  typosquat_dependency: "疑似 typosquat 依赖",
  dynamic_download_l2: "嵌套动态下载",
  base64_decode_pipe: "Base64 解码后执行",
};
const GUARD_PATTERN_LABEL_HIGH_ENTROPY = "high_entropy_secret";

function guardVerdictLabel(v: string): string {
  return v === "dangerous" ? "高危" : v === "caution" ? "需注意" : "未见高危规则";
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
            外部
          </span>
        ) : null}
        <span className="ml-auto text-[11px] text-text-faint">
          {[item.grade ? `等级 ${item.grade}` : "", typeof item.score === "number" ? `${item.score} 分` : "", item.tier]
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
                    ? "高熵可疑字符串"
                    : f.pattern_name)}
                {f.matched_text ? (
                  <span className="text-text-faint">：「{f.matched_text.slice(0, 50)}」</span>
                ) : null}
              </span>
            </li>
          ))}
          {findings.length > 5 ? (
            <li className="text-text-faint">… 另有 {findings.length - 5} 条</li>
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
                ? "请先在技能配置页开启「允许助手改本地技能」"
                : "委派元智能体新会话修复；写入前会展示 diff 供确认"
            }
            onClick={onAiFix}
          >
            AI 修复
          </button>
        ) : (
          <span className="text-[11px] text-text-faint">外部来源只读，可禁用或忽略</span>
        )}
        {item.can_fix && hasSnapshot ? (
          <button
            type="button"
            className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-300 transition hover:bg-amber-500/15 disabled:opacity-50"
            disabled={busy || !onRestore}
            title="恢复到本次 AI 修复前自动保存的快照"
            onClick={onRestore}
          >
            恢复备份
          </button>
        ) : null}
        <button
          type="button"
          className="rounded-md border border-border px-2.5 py-1 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
          disabled={busy}
          title="模型不再加载该技能，文件保留"
          onClick={onDisable}
        >
          禁用
        </button>
        <button
          type="button"
          className="rounded-md border border-border px-2.5 py-1 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
          disabled={busy}
          title="后续扫描默认跳过该技能"
          onClick={onIgnore}
        >
          忽略
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
        <div className="text-xs font-semibold text-text-strong">{title}</div>
        <p className="mt-1 text-xs leading-relaxed text-text-muted">{description}</p>
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
        setGuardFixMsg("请先在技能配置页开启「允许助手改本地技能」，再使用 AI 修复。");
        return;
      }
      const prompt = buildGuardFixPrompt(item);
      if (!prompt.trim()) {
        setGuardFixMsg("缺少技能目录，无法委派修复。");
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
            setGuardFixMsg(`备份未创建（${snap.error}），仍将继续修复。`);
          }
        }
        const created = await window.agenticxDesktop.createSession({});
        if (!created.ok || !created.session_id) {
          setGuardFixMsg(created.error ?? "创建元智能体会话失败");
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
      <Panel title="技能安全">
        <div className="py-2 text-sm text-text-faint">加载中…</div>
      </Panel>
    );
  }

  return (
    <Panel title="技能安全">
      <div className="space-y-3">
        <SettingsToggleCard
          title="未见高危则自动装完"
          description="安装前仍会跑一遍静态规则扫描并展示摘要；只有未命中高危规则时才可能一路装完，一旦命中高危必须你点确认。"
          checked={nonHighRiskAutoInstall}
          disabled={busy}
          onChange={(next) => void updatePolicy(next)}
        />
        <div className="rounded-xl border border-border bg-surface-card px-4 py-3.5">
          <div className="text-xs font-semibold text-text-strong">技能安全扫描</div>
          <div className="mt-1 space-y-1 text-xs leading-relaxed text-text-muted">
            <p>
              从技能市场、Bundle 或扩展安装前会<strong className="font-medium text-text-subtle">自动扫描</strong>
              ，命中高危须你确认后才可安装。已安装的技能可用下方「扫描已安装技能」复查，逐个列出问题并给出处置选项。本页配置写入{" "}
              <code className="text-text-subtle">~/.agenticx/config.yaml</code>，重启后生效。
            </p>
            <p>
              <span className="text-text-subtle">引擎 v1</span>：经典正则规则，与历史版本行为一致。
              <span className="text-text-subtle">引擎 v2</span>：YAML 规则库，按技能体量分级扫描，并给出 0–100
              分与安全等级，规则更全（推荐）。
            </p>
            <p>
              <span className="text-text-subtle">扫描模式</span>（仅 v2 对安装流程生效）：
              <span className="text-text-subtle">快速</span>—主要检查 SKILL.md，跳过重项，最快；
              <span className="text-text-subtle">标准</span>—按目录文件量自动选深度，默认推荐；
              <span className="text-text-subtle">完整</span>—尽量扫全目录与依赖，更严、更慢。
            </p>
          </div>
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <span className="shrink-0 text-xs text-text-muted">引擎版本</span>
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
              <span className="shrink-0 text-xs text-text-muted">扫描模式</span>
              <SettingsDropdown
                value={scanMode}
                displayLabel={
                  scanMode === "quick" ? "快速" : scanMode === "full" ? "完整" : "标准"
                }
                options={[
                  { value: "quick", label: "快速" },
                  { value: "standard", label: "标准" },
                  { value: "full", label: "完整" },
                ]}
                onChange={(v) => void saveGuard({ scan_mode: v })}
                disabled={busy || guardVersion < 2}
                size="compact"
                menuPortal
                className="w-[7rem] shrink-0"
                title={guardVersion < 2 ? "仅引擎 v2 支持扫描模式" : undefined}
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
              {scanBusy ? "扫描中…" : "扫描已安装技能"}
            </button>
            <span className="text-[11px] text-text-faint">
              逐个技能扫描，仅列出有问题的。扫描只出报告，不会自动改动。
            </span>
          </div>
          {guardMessage ? (
            <div className={`mt-2 text-xs ${guardMessage.startsWith("已保存") ? "text-text-muted" : "text-rose-400"}`}>
              {guardMessage}
            </div>
          ) : null}
          {scanMsg ? <div className="mt-2 text-xs text-rose-400">{scanMsg}</div> : null}
          {guardFixMsg ? (
            <div
              className={`mt-2 text-xs ${guardFixMsg.includes("技能配置页") || guardFixMsg.includes("备份未创建") ? "text-amber-400" : "text-rose-400"}`}
            >
              {guardFixMsg}
            </div>
          ) : null}
          {restoreMsg ? (
            <div
              className={`mt-2 text-xs ${restoreMsg.startsWith("已恢复") ? "text-emerald-400" : "text-rose-400"}`}
            >
              {restoreMsg}
            </div>
          ) : null}
          {scanned && !scanBusy ? (
            scanResults.length === 0 ? (
              <div className="mt-3 rounded-md border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-400">
                未发现有风险的已安装技能。
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
              <div className="text-[11px] text-text-faint">已忽略（不再扫出）：</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {ignoredSkills.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-panel px-2 py-0.5 text-[11px] text-text-muted transition hover:text-text-primary disabled:opacity-50"
                    disabled={actionBusy === name}
                    title="点击撤销忽略"
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
          className={`mt-2 text-xs ${policyMessage.startsWith("已保存") ? "text-text-muted" : "text-rose-400"}`}
        >
          {policyMessage}
        </div>
      ) : null}
    </Panel>
  );
}
