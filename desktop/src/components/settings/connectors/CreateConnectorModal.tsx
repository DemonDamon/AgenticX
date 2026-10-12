/**
 * Comate 风格「新建连接器」弹层（Near 深色主题）：
 * 标题+副标题 → 已选择模板 → 连接器名称 → 新建凭证(+如何获取) → 凭据字段；
 * 目录已知官方端点时不显示 URL（与 Comate 一致）；仅无官方端点的模板在可折叠「高级」里填 MCP URL。
 * 模板元数据（凭证标签/占位/帮助链接/端点/鉴权位置）渲染期按 supplyId 取自 CONNECTOR_SUPPLY。
 * 写入 ~/.agenticx/mcp.json 后回调刷新「我的连接」。
 *
 * 不重复建设：同模板已有实例时显示「已存在连接：<name>」，主按钮改为「更新凭证」，
 * 写回同一 server（applyCreateConnectorToMcpJson overwrite），绝不新增第二条。
 * 作为「从模板新建」第 2 步时传 onBack：显示「重选」「上一步」。
 *
 * mcp_oauth（官方远程 MCP + OAuth 2.1 动态客户端注册）：只填名称 + 灰色说明，官方 URL 预填进折叠的「高级」；
 * 写盘后由宿主 onCreated(oauth=true) 触发浏览器授权，令牌不经此表单。
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ExternalLink, Info, Loader2, X } from "lucide-react";
import { Modal } from "../../ds/Modal";
import { MCP_PRIMARY_CONFIG_PATH } from "../../../utils/mcp-remote-config";
import { MarketIcon } from "../../marketplace/MarketIcon";
import { authFormFields, type ConnectorAuthType, type ConnectorCredentialField } from "./connector-supply";
import {
  applyCreateConnectorToMcpJson,
  credentialHelpHref,
  resolveCreateTargetWithSupply,
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
  /** API Key 写入 URL 查询参数名（如高德 `key`）；缺省走 Bearer 头。 */
  apiKeyQuery?: string;
  /** 凭证写进自定义请求头（如盈米 `x-api-key`）；缺省 Bearer。 */
  credentialHeader?: string;
  /** 模板凭证字段标签 / 占位 / 帮助链接（见 ConnectorSupplyEntry）。 */
  credentialLabel?: string;
  credentialPlaceholder?: string;
  credentialHelpUrl?: string;
  /** 多字段自定义头（Comate）；有值时优先于单字段 apiKey/token。 */
  credentialFields?: readonly ConnectorCredentialField[];
};

export type CreateConnectorResultPayload = {
  serverName: string;
  displayName: string;
  /** 更新了已存在实例（未新增）。 */
  updated: boolean;
  /** 凭证与端点均未变化，直接复用。 */
  reused: boolean;
  /** mcp_oauth：写盘后需在浏览器完成 MCP OAuth 授权。 */
  oauth?: boolean;
};

type Props = {
  open: boolean;
  target: CreateConnectorTarget | null;
  configPath?: string;
  /** 该模板已存在的连接实例（来自 buildMyConnectionRows SSOT）。 */
  existingConnection?: { name: string } | null;
  /** 「从模板新建」第 2 步：返回模板列表（重选 / 上一步）。 */
  onBack?: () => void;
  /** 已存在实例时「直接使用」。 */
  onUseExisting?: (name: string) => void;
  onClose: () => void;
  onCreated: (payload: CreateConnectorResultPayload) => void | Promise<void>;
};

const EMPTY: CreateConnectorFormValues = { name: "", url: "", apiKey: "", token: "", credentials: {} };

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
  target: targetProp,
  configPath = MCP_PRIMARY_CONFIG_PATH,
  existingConnection = null,
  onBack,
  onUseExisting,
  onClose,
  onCreated,
}: Props) {
  const { t } = useTranslation("marketplace");
  // 所有入口共用：渲染期按 supplyId 合并当前目录元数据（见 resolveCreateTargetWithSupply）。
  const target = useMemo(
    () => (targetProp ? resolveCreateTargetWithSupply(targetProp) : null),
    [targetProp],
  );
  const auth: ConnectorAuthType = target?.authType ?? "custom_credential";
  const fields = useMemo(() => new Set(authFormFields(auth)), [auth]);
  const credentialFields = target?.credentialFields ?? [];
  const hasMultiCredentials = credentialFields.length > 0;
  const needsCredential = hasMultiCredentials || fields.has("api_key") || fields.has("token");
  const isMcpOauth = auth === "mcp_oauth";
  const needsUrl = fields.has("url");
  const [values, setValues] = useState<CreateConnectorFormValues>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [advancedOpen, setAdvancedOpen] = useState(false);
  /** 提交时才从 mcp.json 发现的同模板实例（父层 SSOT 尚未刷新时兜底）。 */
  const [fileExistingName, setFileExistingName] = useState<string | null>(null);
  const existingName = existingConnection?.name ?? fileExistingName;

  useEffect(() => {
    if (!open || !target) return;
    const defaultUrl = (target.defaultMcpUrl ?? "").trim();
    setFileExistingName(null);
    setValues({
      name: existingConnection?.name ?? t("connectors.create.nameDefault", { name: target.name }),
      url: defaultUrl,
      apiKey: "",
      token: "",
      credentials: {},
    });
    // 无默认 endpoint 时展开高级，避免用户找不到必填 URL。
    setAdvancedOpen(needsUrl && !defaultUrl);
    setError("");
    setFieldErrors({});
    // existingConnection 仅在打开时取一次默认名，避免刷新覆盖用户输入。
  }, [open, target, t, needsUrl]);

  const setField = (key: keyof CreateConnectorFormValues, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const setCredentialField = (name: string, value: string) => {
    setValues((prev) => ({
      ...prev,
      credentials: { ...(prev.credentials ?? {}), [name]: value },
    }));
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
      const applied = applyCreateConnectorToMcpJson(raw.text, auth, values, {
        templateId: target.supplyId,
        apiKeyQuery: target.apiKeyQuery,
        credentialHeader: target.credentialHeader,
        credentialFields: target.credentialFields,
        overwrite: Boolean(existingName),
      });
      if (!applied.ok) {
        if (applied.error === "exists" && applied.existing) {
          // 父层未感知到的同模板实例：切换为「更新凭证」模式，不新增。
          setFileExistingName(applied.existing.instance.displayName);
          setError("");
          return;
        }
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
      if (!applied.unchanged) {
        const save = await window.agenticxDesktop.mcpPutRaw({
          path: configPath,
          text: applied.text,
        });
        if (!save?.ok) {
          setError(save?.error || t("connectors.create.writeFailed"));
          return;
        }
      }
      await onCreated({
        serverName: applied.serverName,
        displayName: applied.displayName || applied.serverName,
        updated: applied.existed && !applied.unchanged,
        reused: applied.unchanged,
        ...(isMcpOauth ? { oauth: true } : {}),
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!target) return null;

  const helpHref = credentialHelpHref(target);
  const hasOfficialUrl = Boolean((target.defaultMcpUrl ?? "").trim());
  const credentialLabel = target.credentialLabel?.trim();
  const credentialPlaceholder = target.credentialPlaceholder?.trim();
  const openHelp = (e: { preventDefault: () => void }) => {
    if (!helpHref) return;
    // <a target=_blank> 会被主进程路由进应用内浏览器；凭证帮助页走系统浏览器（open-external IPC）。
    const api = typeof window !== "undefined" ? window.agenticxDesktop : undefined;
    if (api?.openExternal) {
      e.preventDefault();
      void api.openExternal(helpHref);
    }
  };

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
            onClick={onBack ?? onClose}
          >
            {onBack ? t("connectors.newMenu.back") : t("connectors.create.close")}
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg bg-btnPrimary px-4 py-2 text-xs font-medium text-btnPrimary-text hover:bg-btnPrimary-hover disabled:opacity-50"
            disabled={saving}
            onClick={() => void handleSubmit()}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
            {existingName
              ? needsCredential
                ? t("connectors.create.updateCredential")
                : t("connectors.create.updateConnection")
              : t("connectors.create.submit")}
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

        {/* 已选择模板（Comate：浅蓝灰底，仅图标 + 名称；从模板列表进入时右侧「重选」） */}
        <div>
          <div className="mb-1.5 text-[11px] text-text-faint">{t("connectors.create.selectedTemplate")}</div>
          <div
            className="flex items-center gap-2.5 rounded-lg border border-[rgba(100,116,139,0.18)] bg-[rgba(100,116,139,0.08)] px-3 py-2.5"
            data-selected-template={target.supplyId ?? target.name}
          >
            <MarketIcon name={target.name} iconSrc={target.iconSrc} className="h-7 w-7" />
            <div className="min-w-0 flex-1 truncate text-sm font-medium text-text-strong">{target.name}</div>
            {onBack ? (
              <button
                type="button"
                className="shrink-0 rounded-md px-2 py-1 text-[12px] text-text-muted transition hover:bg-surface-hover hover:text-text-strong disabled:opacity-50"
                disabled={saving}
                onClick={onBack}
                data-template-reselect
              >
                {t("connectors.newMenu.reselect")}
              </button>
            ) : null}
          </div>
        </div>

        {/* 不重复建设：同模板已有实例 → 直接使用 / 更新凭证 */}
        {existingName ? (
          <div
            className="flex items-start gap-2 rounded-lg border border-border-strong bg-surface-cardSolid px-3 py-2.5"
            data-connector-existing={existingName}
          >
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-medium text-text-strong">
                {t("connectors.create.existsTitle", { name: existingName })}
              </div>
              <p className="mt-0.5 text-[11px] leading-relaxed text-text-muted">
                {needsCredential ? t("connectors.create.existsHint") : t("connectors.create.existsHintNoCredential")}
              </p>
            </div>
            {onUseExisting ? (
              <button
                type="button"
                className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-text-strong transition hover:bg-surface-hover disabled:opacity-50"
                disabled={saving}
                onClick={() => onUseExisting(existingName)}
              >
                {t("connectors.create.useExisting")}
              </button>
            ) : null}
          </div>
        ) : null}

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

        {/* mcp_oauth：无凭据字段，仅说明（Comate 同款灰字） */}
        {isMcpOauth ? (
          <p className="-mt-2 text-[12px] leading-relaxed text-text-faint" data-oauth-dcr-hint>
            {t("connectors.create.oauthDcrHint")}
          </p>
        ) : null}

        {/* 新建凭证 */}
        {needsCredential ? (
          <div className="space-y-3">
            <div>
              <div className="text-[13px] font-semibold text-text-strong">
                {t("connectors.create.credentialSection")}
              </div>
              {helpHref ? (
                <a
                  href={helpHref}
                  target="_blank"
                  rel="noreferrer"
                  onClick={openHelp}
                  data-credential-help={helpHref}
                  // Comate 同款蓝色外链（不随主题强调色变化），深浅主题均可读。
                  className="mt-1 inline-flex items-center gap-1 text-[12px] text-[#3B82F6] hover:underline"
                >
                  {t("connectors.create.howToGetCredential")}
                  <ExternalLink className="h-3 w-3" aria-hidden />
                </a>
              ) : null}
            </div>

            {hasMultiCredentials
              ? credentialFields.map((f) => {
                  const required = f.required !== false;
                  return (
                    <label key={f.name} className="block" data-credential-field={f.name}>
                      <FieldLabel required={required}>{f.label}</FieldLabel>
                      <TextInput
                        type={f.inputType === "text" ? "text" : "password"}
                        value={(values.credentials ?? {})[f.name] ?? ""}
                        onChange={(v) => setCredentialField(f.name, v)}
                        placeholder={f.placeholder || f.label}
                      />
                      {fieldErrors[f.name] ? (
                        <span className="mt-1 block text-[11px] text-rose-400">{fieldErrors[f.name]}</span>
                      ) : null}
                    </label>
                  );
                })
              : null}

            {!hasMultiCredentials && fields.has("api_key") ? (
              <label className="block">
                <FieldLabel required>{credentialLabel || t("connectors.create.fields.apiKey")}</FieldLabel>
                <TextInput
                  type="password"
                  value={values.apiKey}
                  onChange={(v) => setField("apiKey", v)}
                  placeholder={credentialPlaceholder || t("connectors.create.placeholders.apiKey")}
                />
                {fieldErrors.apiKey ? (
                  <span className="mt-1 block text-[11px] text-rose-400">{fieldErrors.apiKey}</span>
                ) : null}
              </label>
            ) : null}

            {!hasMultiCredentials && fields.has("token") ? (
              <label className="block">
                <FieldLabel required>{credentialLabel || t("connectors.create.fields.token")}</FieldLabel>
                <TextInput
                  type="password"
                  value={values.token}
                  onChange={(v) => setField("token", v)}
                  placeholder={credentialPlaceholder || t("connectors.create.placeholders.token")}
                />
                {fieldErrors.token ? (
                  <span className="mt-1 block text-[11px] text-rose-400">{fieldErrors.token}</span>
                ) : null}
              </label>
            ) : null}
          </div>
        ) : null}

        {/* 无官方端点时才需要 URL（收进高级区）；目录已知官方端点 → 与 Comate 一致不显示 URL */}
        {needsUrl && !hasOfficialUrl ? (
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
                <p className="text-[11px] leading-relaxed text-text-faint">{t("connectors.create.advancedHint")}</p>
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
