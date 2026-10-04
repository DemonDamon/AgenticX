/**
 * MCP 连接器详情浮层:打开时实时拉取市场详情,
 * 展示描述 / 将添加的 server / 所需环境变量表单,「安装」后由父级执行安装。
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { Modal } from "../ds/Modal";
import { extractMcpServerNames } from "./model";

type Props = {
  serverId: string | null;
  installing: boolean;
  onClose: () => void;
  /** 返回是否安装成功(成功则关闭浮层)。 */
  onInstall: (serverId: string, env: Record<string, string>) => Promise<boolean>;
};

type DetailState = {
  loading: boolean;
  name: string;
  description: string;
  serverNames: string[];
  requiredEnv: string[];
};

const EMPTY_DETAIL: DetailState = {
  loading: true,
  name: "",
  description: "",
  serverNames: [],
  requiredEnv: [],
};

function cleanDescription(input: unknown): string {
  const raw = String(input ?? "");
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function PluginDetailModal({ serverId, installing, onClose, onInstall }: Props) {
  const { t } = useTranslation("marketplace");
  const [detail, setDetail] = useState<DetailState>(EMPTY_DETAIL);
  const [envForm, setEnvForm] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!serverId) return;
    let cancelled = false;
    setDetail(EMPTY_DETAIL);
    setEnvForm({});
    void (async () => {
      try {
        const res = await window.agenticxDesktop.mcpMarketplaceDetail({ serverId });
        if (cancelled) return;
        const item = (res?.item as Record<string, unknown> | undefined) ?? undefined;
        const requiredRaw = (item as { env_schema?: { required?: unknown } } | undefined)?.env_schema
          ?.required;
        setDetail({
          loading: false,
          name: String(item?.chinese_name || item?.name || serverId),
          description: cleanDescription(item?.description),
          serverNames: extractMcpServerNames(item),
          requiredEnv: (Array.isArray(requiredRaw) ? requiredRaw : []).filter(
            (x): x is string => typeof x === "string",
          ),
        });
      } catch {
        if (!cancelled) setDetail({ ...EMPTY_DETAIL, loading: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serverId]);

  return (
    <Modal open={Boolean(serverId)} title={detail.name || t("actions.detail")} onClose={onClose}>
      <div className="space-y-4" data-market-plugin-detail>
        {detail.loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-text-faint">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {t("loading")}
          </div>
        ) : (
          <>
            <p className="text-[13px] leading-relaxed text-text-muted">
              {detail.description || t("empty.desc")}
            </p>

            {detail.serverNames.length > 0 ? (
              <div>
                <div className="mb-1.5 text-xs font-medium text-text-strong">
                  {t("pluginDetail.tools")}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {detail.serverNames.map((name) => (
                    <span
                      key={name}
                      className="rounded-md border border-border bg-surface-card px-2 py-0.5 font-mono text-[11px] text-text-muted"
                    >
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <div>
              <div className="mb-1.5 text-xs font-medium text-text-strong">{t("pluginDetail.env")}</div>
              {detail.requiredEnv.length === 0 ? (
                <div className="text-xs text-text-faint">—</div>
              ) : (
                <div className="space-y-2">
                  {detail.requiredEnv.map((key) => (
                    <label key={key} className="block text-xs text-text-muted">
                      {key}
                      <input
                        type="text"
                        className="mt-1 w-full rounded-md border border-border bg-surface-card px-2.5 py-1.5 text-[13px] text-text-primary outline-none transition placeholder:text-text-faint focus:border-accent"
                        value={envForm[key] ?? ""}
                        onChange={(e) => setEnvForm((prev) => ({ ...prev, [key]: e.target.value }))}
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </label>
                  ))}
                </div>
              )}
              <p className="mt-2 text-[11px] text-text-faint">{t("pluginDetail.installHint")}</p>
            </div>
          </>
        )}
      </div>
      <div className="-mx-4 -mb-4 mt-4 flex justify-end gap-2 border-t border-border px-4 pt-3">
        <button
          type="button"
          className="rounded-md border border-border px-3 py-1.5 text-xs text-text-muted transition hover:bg-surface-hover hover:text-text-strong disabled:opacity-40"
          disabled={installing}
          onClick={onClose}
        >
          {t("scan.cancel")}
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-40"
          disabled={installing || detail.loading}
          onClick={async () => {
            if (!serverId) return;
            const ok = await onInstall(serverId, envForm);
            if (ok) onClose();
          }}
        >
          {installing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
          {installing ? t("actions.installing") : t("actions.install")}
        </button>
      </div>
    </Modal>
  );
}
