/**
 * Comate 风格「新建连接器」弹层（Near 深色主题）：
 * 标题+副标题 → 已选择模板 → 连接器名称 → 新建凭证(+如何获取) → 凭据字段；
 * MCP URL 收入可折叠「高级」以贴近 Comate（轻流表单不突出 endpoint）。
 * 写入 ~/.agenticx/mcp.json 后回调刷新「我的连接」。
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ExternalLink, Loader2, X } from "lucide-react";
import { Modal } from "../../ds/Modal";
import { MCP_PRIMARY_CONFIG_PATH } from "../../../utils/mcp-remote-config";
import { MarketIcon } from "../../marketplace/MarketIcon";
import { authFormFields, type ConnectorAuthType } from "./connector-supply";
import {
  applyCreateConnectorToMcpJson,
  type CreateConnectorFormValues,
} from "./create-connector-model";

export type CreateConnectorTarget = {
  name: string;
  authType: ConnectorAuthType;
  description?: string;
  iconSrc?: string;
  supplyId?: string;
  /** 模板「如何获取凭证」文档；缺省则隐藏链接。 */
  docsUrl?: string;
  /** 目录已知默认 MCP endpoint；有则预填并可保持高级区折叠。 */
  defaultMcpUrl?: string;
};

type Props = {
  open: boolean;
  target: CreateConnectorTarget | null;
  configPath?: string;
  onClose: () => void;
  onCreated: (payload: { serverName: string }) => void | Promise<void>;
};

const EMPTY: CreateConnectorFormValues = { name: "", url: "", apiKey: "", token: "" };

function FieldLabel({ children, required }: { children: ReactNode; required?: boolean }) {
  return (
    <span className="text-[12px] font-semibold text-text-strong">
      {children}
      {required ? <span className="ml-0.5 text-rose-400">*</span> : null}
    </span>
  );
}

function TextInput({
  type = "text",
  value,
  onChange,
  placeholder,
  autoComplete = "off",
}: {
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
}) {
  return (
    <input
      type={type}
      className="mt-1.5 w-full rounded-lg border border-border bg-surface-card px-3 py-2.5 text-sm text-text-primary outline-none placeholder:text-text-faint focus:border-border-strong"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoComplete={autoComplete}
    />
  );
}

export function CreateConnectorModal({
  open,
  target,
  configPath = MCP_PRIMARY_CONFIG_PATH,
  onClose,
  onCreated,
}: Props) {
  const { t } = useTranslation("marketplace");
  const auth: ConnectorAuthType = target?.authType ?? "custom_credential";
  const fields = useMemo(() => new Set(authFormFields(auth)), [auth]);
  const needsCredential = fields.has("api_key") || fields.has("token");
  const needsUrl = fields.has("url");
  const [values, setValues] = useState<CreateConnectorFormValues>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    if (!open || !target) return;
    const defaultUrl = (target.defaultMcpUrl ?? "").trim();
    setValues({
      name: t("connectors.create.nameDefault", { name: target.name }),
      url: defaultUrl,
      apiKey: "",
      token: "",
    });
    // 无默认 endpoint 时展开高级，避免用户找不到必填 URL。
    setAdvancedOpen(needsUrl && !defaultUrl);
    setError("");
    setFieldErrors({});
  }, [open, target, t, needsUrl]);

  const setField = (key: keyof CreateConnectorFormValues, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const mapError = (code: string | undefined): string => {
    if (!code) return "";
    return t(`connectors.create.errors.${code}`, { defaultValue: code });
  };

  const handleSubmit = async () => {
    if (!target) return;
    setSaving(true);
    setError("");
    setFieldErrors({});
    try {
      const raw = await window.agenticxDesktop.mcpGetRaw({ path: configPath });
      if (!raw?.ok || typeof raw.text !== "string") {
        setError(raw?.error || t("connectors.create.readFailed"));
        return;
      }
      const applied = applyCreateConnectorToMcpJson(raw.text, auth, values);
      if (!applied.ok) {
        if (applied.error === "invalid_form" && applied.errors) {
          const next: Record<string, string> = {};
          for (const [k, v] of Object.entries(applied.errors)) {
            if (v) next[k] = mapError(v);
          }
          setFieldErrors(next);
          if (applied.errors.url) setAdvancedOpen(true);
          setError(t("connectors.create.formInvalid"));
          return;
        }
        if (applied.error === "duplicate") {
          setError(t("connectors.create.duplicate"));
          return;
        }
        setError(t("connectors.create.writeFailed"));
        return;
      }
      const save = await window.agenticxDesktop.mcpPutRaw({
        path: configPath,
        text: applied.text,
      });
      if (!save?.ok) {
        setError(save?.error || t("connectors.create.writeFailed"));
        return;
      }
      await onCreated({ serverName: applied.serverName });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!target) return null;

  const docsUrl = target.docsUrl?.trim();

  return (
    <Modal
      open={open}
      panelClassName="w-[min(520px,94vw)] bg-surface-popover"
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-border bg-surface-cardSolid px-4 py-2 text-xs font-medium text-text-primary hover:bg-surface-cardSolidHover disabled:opacity-50"
            disabled={saving}
            onClick={onClose}
          >
            {t("connectors.create.close")}
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
            disabled={saving}
            onClick={() => void handleSubmit()}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
            {t("connectors.create.submit")}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Comate: 标题 + 副标题 + 右上角 X（不用 Modal 默认「关闭」头） */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-text-strong">{t("connectors.create.title")}</h3>
            <p className="mt-1 text-[12px] leading-relaxed text-text-muted">
              {t("connectors.create.subtitle")}
            </p>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-md p-1 text-text-faint transition hover:bg-surface-hover hover:text-text-strong"
            aria-label={t("connectors.create.close")}
            disabled={saving}
            onClick={onClose}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {/* 已选择模板 */}
        <div>
          <div className="mb-1.5 text-[11px] text-text-faint">{t("connectors.create.selectedTemplate")}</div>
          <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-cardSolid px-3 py-2.5">
            <MarketIcon name={target.name} iconSrc={target.iconSrc} className="h-9 w-9" />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-text-strong">{target.name}</div>
            </div>
          </div>
        </div>

        {/* 连接器名称 * */}
        {fields.has("name") ? (
          <label className="block">
            <FieldLabel required>{t("connectors.create.fields.name")}</FieldLabel>
            <TextInput
              value={values.name}
              onChange={(v) => setField("name", v)}
              placeholder={t("connectors.create.placeholders.name")}
            />
            {fieldErrors.name ? (
              <span className="mt-1 block text-[11px] text-rose-400">{fieldErrors.name}</span>
            ) : null}
          </label>
        ) : null}

        {/* 新建凭证 */}
        {needsCredential ? (
          <div className="space-y-3">
            <div>
              <div className="text-[13px] font-semibold text-text-strong">
                {t("connectors.create.credentialSection")}
              </div>
              {docsUrl ? (
                <a
                  href={docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-[12px] text-accent hover:underline"
                >
                  {t("connectors.create.howToGetCredential")}
                  <ExternalLink className="h-3 w-3" aria-hidden />
                </a>
              ) : null}
            </div>

            {fields.has("api_key") ? (
              <label className="block">
                <FieldLabel required>{t("connectors.create.fields.apiKey")}</FieldLabel>
                <TextInput
                  type="password"
                  value={values.apiKey}
                  onChange={(v) => setField("apiKey", v)}
                  placeholder={t("connectors.create.placeholders.apiKey")}
                />
                {fieldErrors.apiKey ? (
                  <span className="mt-1 block text-[11px] text-rose-400">{fieldErrors.apiKey}</span>
                ) : null}
              </label>
            ) : null}

            {fields.has("token") ? (
              <label className="block">
                <FieldLabel required>{t("connectors.create.fields.token")}</FieldLabel>
                <TextInput
                  type="password"
                  value={values.token}
                  onChange={(v) => setField("token", v)}
                  placeholder={t("connectors.create.placeholders.token")}
                />
                {fieldErrors.token ? (
                  <span className="mt-1 block text-[11px] text-rose-400">{fieldErrors.token}</span>
                ) : null}
              </label>
            ) : null}
          </div>
        ) : null}

        {/* none：无凭据时仍可能需要 URL — 放在高级区 */}
        {needsUrl ? (
          <div className="rounded-lg border border-border bg-surface-cardSolid">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[12px] font-medium text-text-muted hover:text-text-strong"
              onClick={() => setAdvancedOpen((v) => !v)}
              aria-expanded={advancedOpen}
            >
              <span>{t("connectors.create.advanced")}</span>
              <ChevronDown
                className={`h-3.5 w-3.5 shrink-0 transition ${advancedOpen ? "rotate-180" : ""}`}
                aria-hidden
              />
            </button>
            {advancedOpen ? (
              <div className="space-y-2 border-t border-border/60 px-3 py-3">
                <p className="text-[11px] leading-relaxed text-text-faint">
                  {t("connectors.create.advancedHint")}
                </p>
                <label className="block">
                  <FieldLabel required>{t("connectors.create.fields.url")}</FieldLabel>
                  <TextInput
                    type="url"
                    value={values.url}
                    onChange={(v) => setField("url", v)}
                    placeholder={t("connectors.create.placeholders.url")}
                  />
                  {fieldErrors.url ? (
                    <span className="mt-1 block text-[11px] text-rose-400">{fieldErrors.url}</span>
                  ) : null}
                </label>
              </div>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-lg border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
            {error}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
