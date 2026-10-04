/**
 * 技能安装状态机(与设置页技能市场的链路一致):
 * preview(安全扫描) → 429 限流自动重试 → install → 确认码分支(non_high / high)。
 * 机器态全部放 ref(避免 useCallback 闭包过期),UI 态镜像到 state 供渲染。
 * 进度与结果文案复用 settings 命名空间的 skills.* 既有 key。
 */

import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";


type ScanSummary = {
  overall: string;
  skills: Array<{
    skill_name: string;
    verdict: string;
    score?: number;
    grade?: string;
    tier?: string;
    findings?: Array<{
      pattern_name: string;
      severity?: string;
      matched_text?: string;
    }>;
  }>;
};

function formatInstallDoneMsg(
  successLine: string,
  scan: ScanSummary | null | undefined,
  t: TFunction,
): string {
  if (!scan?.skills?.length) return successLine;
  return `${successLine}\n\n${formatSkillScanSummary(scan, t)}`;
}

function formatSkillScanSummary(scan: ScanSummary, t: TFunction): string {
  const verdictLabel = (v: string) =>
    v === "dangerous"
      ? t("skills.scan.verdictDanger")
      : v === "caution"
        ? t("skills.scan.verdictCaution")
        : t("skills.scan.verdictOk");
  const sevLabel = (s: string | undefined) =>
    s === "dangerous" ? t("skills.scan.sevDanger") : s === "caution" ? t("skills.scan.sevCaution") : s ?? "";
  const patternLabelOf = (name: string) => {
    const key = `skills.scan.patterns.${name}`;
    const translated = t(key);
    return translated === key ? name : translated;
  };

  const lines = [t("skills.scan.header", { verdict: verdictLabel(scan.overall) })];
  for (const s of scan.skills) {
    const meta: string[] = [];
    if (s.grade) meta.push(t("skills.scan.grade", { grade: s.grade }));
    if (typeof s.score === "number") meta.push(t("skills.scan.score", { score: s.score }));
    if (s.tier) meta.push(s.tier);
    lines.push(
      `· ${s.skill_name || "skill"}：${verdictLabel(s.verdict)}${
        s.findings?.length ? t("skills.scan.hitRules", { count: s.findings.length }) : ""
      }${meta.length ? ` · ${meta.join(" · ")}` : ""}`,
    );
    if (s.findings?.length) {
      for (const f of s.findings.slice(0, 8)) {
        const label = patternLabelOf(f.pattern_name);
        const matched = f.matched_text ? `「${f.matched_text.slice(0, 60)}」` : "";
        lines.push(`  ${sevLabel(f.severity)} ${label}${matched ? " — " + matched : ""}`);
      }
      if (s.findings.length > 8) {
        lines.push(t("skills.scan.moreFindings", { count: s.findings.length - 8 }));
      }
    }
  }
  return lines.join("\n");
}

/** 安装机只需要这两个字段(完整条目由调用方持有)。 */
export type SkillInstallTarget = { source: string; name: string };

export type SkillInstallStatus = {
  busy: boolean;
  installingKey: string | null;
  queuedKeys: string[];
  message: string;
  messageKind: "info" | "success" | "error";
  pending: SkillInstallTarget | null;
  needsConfirmNonHigh: boolean;
  needsConfirmHigh: boolean;
};

const INITIAL_STATUS: SkillInstallStatus = {
  busy: false,
  installingKey: null,
  queuedKeys: [],
  message: "",
  messageKind: "info",
  pending: null,
  needsConfirmNonHigh: false,
  needsConfirmHigh: false,
};

export function useSkillInstall(onInstalled?: (name: string) => void) {
  const { t } = useTranslation("settings");
  const [status, setStatus] = useState<SkillInstallStatus>(INITIAL_STATUS);
  const busyRef = useRef(false);
  const installingKeyRef = useRef<string | null>(null);
  const queueRef = useRef<SkillInstallTarget[]>([]);
  const pendingRef = useRef<SkillInstallTarget | null>(null);
  const onInstalledRef = useRef(onInstalled);
  onInstalledRef.current = onInstalled;

  const patch = useCallback((partial: Partial<SkillInstallStatus>) => {
    setStatus((prev) => ({ ...prev, ...partial }));
  }, []);

  /** 安装一个 registry 技能;忙时点击 = 加入队列(与设置页行为一致)。 */
  const install = useCallback(
    async (item: SkillInstallTarget) => {
      const key = `${item.source}:${item.name}`;
      if (busyRef.current && installingKeyRef.current && installingKeyRef.current !== key) {
        if (!queueRef.current.some((q) => q.source === item.source && q.name === item.name)) {
          queueRef.current.push(item);
          setStatus((s) => ({ ...s, queuedKeys: [...s.queuedKeys, key] }));
        }
        patch({
          message: t("skills.installQueued", {
            current: installingKeyRef.current.split(":")[1] ?? "",
            queued: item.name,
          }),
          messageKind: "info",
        });
        return;
      }
      queueRef.current = queueRef.current.filter(
        (q) => !(q.source === item.source && q.name === item.name),
      );
      setStatus((s) => ({ ...s, queuedKeys: s.queuedKeys.filter((k) => k !== key) }));
      busyRef.current = true;
      installingKeyRef.current = key;
      pendingRef.current = null;
      patch({
        busy: true,
        installingKey: key,
        pending: null,
        needsConfirmNonHigh: false,
        needsConfirmHigh: false,
        message: t("skills.pulling", { name: item.name }),
        messageKind: "info",
      });
      let pauseQueue = false;
      try {
        const prev = await window.agenticxDesktop.installFromRegistryPreview({
          source: item.source,
          name: item.name,
        });
        if (!prev.ok) {
          const rawErr = String(prev.error ?? t("commonSettings.unknownError"));
          const is429 = rawErr.includes("rate limited (429)") || rawErr.includes("Too Many Requests");
          if (is429) {
            const secMatch = rawErr.match(/about (\d+)s/);
            const waitSec = secMatch ? Math.min(Number(secMatch[1]), 30) : 10;
            patch({ message: t("skills.rateLimited", { seconds: waitSec }), messageKind: "info" });
            await new Promise((r) => setTimeout(r, waitSec * 1000));
            patch({ message: t("skills.repulling", { name: item.name }), messageKind: "info" });
            const retry = await window.agenticxDesktop.installFromRegistryPreview({
              source: item.source,
              name: item.name,
            });
            if (!retry.ok) {
              patch({
                message: t("skills.pullFailed", {
                  reason: String(retry.error ?? t("commonSettings.unknownError")),
                }),
                messageKind: "error",
              });
              return;
            }
            Object.assign(prev, retry);
          } else if (rawErr.includes("fetch failed") || rawErr.includes("Failed to fetch skill")) {
            patch({ message: t("skills.pullFailed", { reason: rawErr }), messageKind: "error" });
            return;
          } else {
            patch({ message: t("skills.scanFailed", { reason: rawErr }), messageKind: "error" });
            return;
          }
        }
        if (prev.scan) {
          patch({ message: formatSkillScanSummary(prev.scan, t), messageKind: "info" });
        }

        const res = await window.agenticxDesktop.installFromRegistry({
          source: item.source,
          name: item.name,
        });
        if (res.ok) {
          patch({
            message: formatInstallDoneMsg(
              t("skills.installedNamed", { name: item.name }),
              res.scan_summary ?? prev.scan,
              t,
            ),
            messageKind: "success",
          });
          onInstalledRef.current?.(String(res.name ?? item.name));
          return;
        }
        if (res.error_code === "non_high_risk_confirm_required") {
          pendingRef.current = item;
          pauseQueue = true;
          patch({
            pending: item,
            needsConfirmNonHigh: true,
            message: res.scan_summary
              ? t("skills.confirmThenWriteWithScan", {
                  summary: formatSkillScanSummary(res.scan_summary, t),
                })
              : t("skills.confirmThenWrite"),
            messageKind: "info",
          });
          return;
        }
        if (res.error_code === "high_risk_confirm_required") {
          pendingRef.current = item;
          pauseQueue = true;
          patch({
            pending: item,
            needsConfirmHigh: true,
            message: res.scan_summary
              ? t("skills.highRiskConfirmWithScan", {
                  summary: formatSkillScanSummary(res.scan_summary, t),
                })
              : t("skills.highRiskConfirm"),
            messageKind: "info",
          });
          return;
        }
        patch({
          message: t("skills.installFailedReason", {
            reason: res.error ?? t("commonSettings.unknownError"),
          }),
          messageKind: "error",
        });
      } catch (e) {
        patch({ message: String(e), messageKind: "error" });
      } finally {
        busyRef.current = false;
        installingKeyRef.current = null;
        patch({ busy: false, installingKey: null });
        if (!pauseQueue && queueRef.current.length > 0) {
          const next = queueRef.current.shift()!;
          const nextKey = `${next.source}:${next.name}`;
          setStatus((s) => ({ ...s, queuedKeys: s.queuedKeys.filter((k) => k !== nextKey) }));
          setTimeout(() => {
            void install(next);
          }, 0);
        }
      }
    },
    // install 通过 ref / 函数式 setState 读写最新状态,避免闭包过期。
    [patch, t],
  );

  /** 用户在确认条上点「继续安装」。 */
  const confirm = useCallback(
    async (kind: "non_high" | "high") => {
      const pending = pendingRef.current;
      if (!pending) return;
      busyRef.current = true;
      installingKeyRef.current = `${pending.source}:${pending.name}`;
      patch({ busy: true, installingKey: `${pending.source}:${pending.name}` });
      try {
        const res = await window.agenticxDesktop.installFromRegistry({
          source: pending.source,
          name: pending.name,
          confirmNonHighRisk: kind === "non_high",
          acknowledgeHighRisk: kind === "high",
        });
        pendingRef.current = null;
        patch({ needsConfirmNonHigh: false, needsConfirmHigh: false, pending: null });
        if (res.ok) {
          patch({
            message: formatInstallDoneMsg(
              t("skills.installedNamed", { name: pending.name }),
              res.scan_summary,
              t,
            ),
            messageKind: "success",
          });
          onInstalledRef.current?.(String(res.name ?? pending.name));
        } else {
          patch({
            message: t("skills.installFailedReason", {
              reason: res.error ?? t("commonSettings.unknownError"),
            }),
            messageKind: "error",
          });
        }
      } catch (e) {
        patch({ message: String(e), messageKind: "error" });
      } finally {
        busyRef.current = false;
        installingKeyRef.current = null;
        patch({ busy: false, installingKey: null });
      }
    },
    [patch, t],
  );

  /** 用户在确认条上点「取消」。 */
  const cancelConfirm = useCallback(() => {
    pendingRef.current = null;
    patch({ needsConfirmNonHigh: false, needsConfirmHigh: false, pending: null, message: "" });
  }, [patch]);

  return { status, install, confirm, cancelConfirm };
}
