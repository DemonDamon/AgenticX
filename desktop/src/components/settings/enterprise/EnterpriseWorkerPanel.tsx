import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useAppStore } from "../../../store";
import { studioFetch } from "../../../utils/studio-fetch";
import { SettingsSwitch } from "../SettingsSwitch";
import {
  parseEnterpriseWorkerStatus,
  workerStateLabelKey,
  type EnterpriseWorkerStatus,
} from "./enterprise-worker-status";

type ToggleField = "enabled" | "ma_enabled";

function patchStatus(field: ToggleField, next: boolean, current: EnterpriseWorkerStatus): EnterpriseWorkerStatus {
  switch (field) {
    case "enabled":
      return { ...current, enabled: next };
    case "ma_enabled":
      return { ...current, maEnabled: next };
    default: {
      const unreachable: never = field;
      return unreachable;
    }
  }
}

function formatStarted(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function httpStatus(error: unknown): number {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status: unknown }).status;
    if (typeof status === "number") return status;
  }
  return 0;
}

export function EnterpriseWorkerPanel() {
  const { t } = useTranslation("settings");
  const apiToken = useAppStore((s) => s.apiToken);
  const [status, setStatus] = useState<EnterpriseWorkerStatus>(() => parseEnterpriseWorkerStatus(null));
  const [saveError, setSaveError] = useState<{ field: ToggleField; message: string } | null>(null);
  const saveGen = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setInterval(() => {
      void refresh();
    }, 5000);
    void refresh();

    async function refresh() {
      const gen = saveGen.current;
      try {
        const response = await studioFetch("/api/enterprise-worker/status", { apiToken });
        if (!response.ok || cancelled || gen !== saveGen.current) return;
        const data: unknown = await response.json();
        if (cancelled || gen !== saveGen.current) return;
        setStatus(parseEnterpriseWorkerStatus(data));
      } catch {
        // Keep the last visible status when a refresh fails.
      }
    }

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [apiToken]);

  async function toggle(field: ToggleField, next: boolean) {
    const previous = status;
    const gen = saveGen.current + 1;
    saveGen.current = gen;
    setSaveError(null);
    setStatus(patchStatus(field, next, status));
    const body = field === "enabled" ? { enabled: next } : { ma_enabled: next };
    try {
      const response = await studioFetch("/api/enterprise-worker", {
        apiToken,
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const failed = new Error("save failed");
        (failed as Error & { status: number }).status = response.status;
        throw failed;
      }
      const data: unknown = await response.json();
      if (gen !== saveGen.current) return;
      setStatus(parseEnterpriseWorkerStatus(data));
    } catch (error) {
      if (gen !== saveGen.current) return;
      setStatus(previous);
      setSaveError({ field, message: t("enterpriseWorker.saveFailed", { status: httpStatus(error) }) });
    }
  }

  const stateKey = workerStateLabelKey(status);

  return (
    <div className="space-y-4 text-sm text-text-strong">
      <div>
        <div className="text-[16px] font-semibold text-text-primary">{t("enterpriseWorker.title")}</div>
        <p className="mt-1 text-xs text-text-subtle leading-relaxed">{t("enterpriseWorker.intro")}</p>
      </div>

      <section className="rounded-lg border border-border bg-surface-card px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-medium">{t("enterpriseWorker.acceptTitle")}</div>
            <p className="mt-1 text-xs text-text-subtle">{t(`enterpriseWorker.state.${stateKey}`)}</p>
          </div>
          <SettingsSwitch
            checked={status.enabled}
            onChange={(next) => void toggle("enabled", next)}
            aria-label={t("enterpriseWorker.acceptTitle")}
          />
        </div>
        {saveError?.field === "enabled" ? (
          <p className="mt-2 text-xs text-amber-500">{saveError.message}</p>
        ) : null}
      </section>

      <section className="rounded-lg border border-border bg-surface-card px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-medium">{t("enterpriseWorker.maTitle")}</div>
            <p className="mt-1 text-xs text-text-subtle leading-relaxed">{t("enterpriseWorker.maHint")}</p>
          </div>
          <SettingsSwitch
            checked={status.maEnabled}
            onChange={(next) => void toggle("ma_enabled", next)}
            aria-label={t("enterpriseWorker.maTitle")}
          />
        </div>
        {saveError?.field === "ma_enabled" ? (
          <p className="mt-2 text-xs text-amber-500">{saveError.message}</p>
        ) : null}
      </section>

      <section className="rounded-lg border border-border bg-surface-card px-4 py-3">
        <div className="font-medium">{t("enterpriseWorker.environments")}</div>
        {!status.maEnabled ? (
          <p className="mt-2 text-xs text-text-subtle">{t("enterpriseWorker.maOff")}</p>
        ) : status.environments.length === 0 ? (
          <p className="mt-2 text-xs text-text-subtle">{t("enterpriseWorker.noEnvironments")}</p>
        ) : (
          <ul className="mt-2 space-y-1 text-xs text-text-strong">
            {status.environments.map((item) => (
              <li key={item.id}>{item.name}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-border bg-surface-card px-4 py-3">
        <div className="font-medium">{t("enterpriseWorker.work")}</div>
        {status.work.length === 0 ? (
          <p className="mt-2 text-xs text-text-subtle">{t("enterpriseWorker.noWork")}</p>
        ) : (
          <table className="mt-2 w-full text-left text-xs">
            <thead className="text-text-subtle">
              <tr>
                <th className="py-1 pr-2 font-medium">{t("enterpriseWorker.col.agent")}</th>
                <th className="py-1 pr-2 font-medium">{t("enterpriseWorker.col.startedAt")}</th>
                <th className="py-1 pr-2 font-medium">{t("enterpriseWorker.col.source")}</th>
                <th className="py-1 font-medium">{t("enterpriseWorker.col.workdir")}</th>
              </tr>
            </thead>
            <tbody>
              {status.work.map((item) => (
                <tr key={item.workId}>
                  <td className="py-1 pr-2">
                    {item.agentId.slice(0, 8)}v{item.agentVersion}
                  </td>
                  <td className="py-1 pr-2">{formatStarted(item.startedAt)}</td>
                  <td className="py-1 pr-2">
                    {item.interactive
                      ? t("enterpriseWorker.source.interactive")
                      : t("enterpriseWorker.source.dispatched")}
                  </td>
                  <td className="py-1 font-mono" title={item.workdir}>
                    {item.workdir}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="space-y-1 text-xs text-text-subtle">
        <div>
          {t("enterpriseWorker.lastHeartbeat")}：{status.lastHeartbeatAt || t("enterpriseWorker.none")}
        </div>
        {status.lastError ? (
          <div className="text-amber-500">
            {t("enterpriseWorker.lastError")}：{status.lastError}
          </div>
        ) : null}
      </div>

      <details className="rounded-lg border border-border bg-surface-card px-4 py-3">
        <summary className="cursor-pointer text-xs text-text-subtle">{t("enterpriseWorker.legacy")}</summary>
        <div className="mt-2 text-xs text-text-subtle">
          {t("enterpriseWorker.legacyAgents")}：
          {status.legacyAgents.length > 0 ? status.legacyAgents.join("、") : t("enterpriseWorker.none")}
        </div>
      </details>
    </div>
  );
}
