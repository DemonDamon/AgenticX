/**
 * 「+ 新建连接器」主按钮 + 下拉（Comate 对标），市场连接器 Tab 与设置「我的连接」共用：
 * - 从对话新建：回到对话并预填「请帮我创建一个连接器」（由宿主 onFromChat 处理导航）
 * - 从模板新建：两步弹层（选择模板 → CreateConnectorModal 配置凭证）
 *
 * 通用 MCP Server 不是连接器：新建 MCP 在插件市场「MCP」页（NewMcpButton）。
 *
 * 不重复建设：已有实例来自 buildMyConnectionRows（SSOT），同模板第 2 步提示
 * 「已存在连接：<name>」并改为更新凭证；模板列表标「已连接」。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  LayoutTemplate,
  MessageSquarePlus,
  Plus,
  Search,
  X,
} from "lucide-react";
import { Modal } from "../../ds/Modal";
import { MarketIcon } from "../../marketplace/MarketIcon";
import { MCP_PRIMARY_CONFIG_PATH } from "../../../utils/mcp-remote-config";
import { CONNECTOR_SUPPLY, findSupplyById } from "./connector-supply";
import type { ConnectorId } from "./connector-catalog";
import { connectorSupplyDisplay } from "./connector-display";
import {
  CreateConnectorModal,
  type CreateConnectorResultPayload,
  type CreateConnectorTarget,
} from "./CreateConnectorModal";
import {
  createTargetExtrasForSupply,
  filterConnectorTemplates,
  listConnectorTemplates,
} from "./create-connector-model";
import {
  connectedSupplyIds,
  findConnectionForSupply,
  type MyConnectionRow,
} from "./my-connections-model";
import { CONNECTOR_ASSISTANT_SKILL_SLUG, skillDraft } from "../../../utils/skill-chip-label";

/** 「从对话新建」预填文案 i18n key（前缀由 {@link buildNewConnectorChatDraft} 加技能胶囊）。 */
export const NEW_CONNECTOR_CHAT_DRAFT_KEY = "connectors.newMenu.chatDraft";

/** 「从对话新建」草稿：⚡连接器助手 技能胶囊 + 文案（@skill:// 在发送时转成 skill_slugs）。 */
export function buildNewConnectorChatDraft(text: string): string {
  return skillDraft(CONNECTOR_ASSISTANT_SKILL_SLUG, text);
}

/** 下拉菜单项（顺序即展示顺序）；不含「新建自定义 MCP」（MCP 在插件市场 MCP 页新建）。 */
export const NEW_CONNECTOR_MENU_ITEMS = ["fromChat", "fromTemplate"] as const;
export type NewConnectorMenuItem = (typeof NEW_CONNECTOR_MENU_ITEMS)[number];

type Props = {
  /** 去重后的连接实例（buildMyConnectionRows，不带搜索过滤）。 */
  connections: readonly MyConnectionRow[];
  /** 从对话新建：宿主负责切到对话并预填 draftText。 */
  onFromChat: (draftText: string) => void;
  /** 原生模板（OAuth / 设备码）走既有握手弹层。 */
  onOpenHandshake?: (connectorId: ConnectorId) => void;
  /** 已存在连接「直接使用」。 */
  onUseConnection?: (name: string) => void;
  /** 新建 / 更新 / 复用完成：宿主刷新 SSOT 并提示（mcp_oauth 时 created.oauth=true，宿主发起授权）。 */
  onChanged: (message: string, created?: CreateConnectorResultPayload) => void | Promise<void>;
  configPath?: string;
  className?: string;
};

type TemplateRow = {
  id: string;
  name: string;
  description: string;
  iconSrc?: string;
  selectable: boolean;
  action: ReturnType<typeof listConnectorTemplates>[number]["action"];
  connectorId?: ConnectorId;
  authType: CreateConnectorTarget["authType"];
};

export function NewConnectorButton({
  connections,
  onFromChat,
  onOpenHandshake,
  onUseConnection,
  onChanged,
  configPath = MCP_PRIMARY_CONFIG_PATH,
  className = "",
}: Props) {
  const { t, i18n } = useTranslation("marketplace");
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createTarget, setCreateTarget] = useState<CreateConnectorTarget | null>(null);
  const [fromPicker, setFromPicker] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const templates = useMemo<TemplateRow[]>(
    () =>
      listConnectorTemplates(CONNECTOR_SUPPLY).map(({ entry, action, selectable }) => {
        const d = connectorSupplyDisplay(entry);
        return {
          id: entry.id,
          name: d.name,
          description: d.description,
          iconSrc: entry.iconSrc,
          selectable,
          action,
          connectorId: entry.connectorId,
          authType: entry.auth,
        };
      }),
    // i18n.language：切换语言时重算展示名。
    [i18n.language],
  );
  const visibleTemplates = useMemo(
    () => filterConnectorTemplates(templates, pickerQuery),
    [templates, pickerQuery],
  );
  const liveIds = useMemo(() => connectedSupplyIds(connections), [connections]);
  const selected = templates.find((x) => x.id === selectedId && x.selectable) ?? null;

  const existing = createTarget ? findConnectionForSupply(connections, createTarget.supplyId) : undefined;

  const openPicker = () => {
    setMenuOpen(false);
    setPickerQuery("");
    setSelectedId(null);
    setPickerOpen(true);
  };

  const goNext = () => {
    if (!selected) return;
    if (selected.action === "handshake" && selected.connectorId) {
      // 原生连接器是单例（一个账号会话），握手弹层自带已连接 / 管理态，不会产生重复实例。
      setPickerOpen(false);
      onOpenHandshake?.(selected.connectorId);
      return;
    }
    setPickerOpen(false);
    setFromPicker(true);
    setCreateTarget({
      name: selected.name,
      authType: selected.authType,
      description: selected.description,
      iconSrc: selected.iconSrc,
      supplyId: selected.id,
      ...createTargetExtrasForSupply(findSupplyById(selected.id)),
    });
  };

  const closeCreate = () => {
    setCreateTarget(null);
    setFromPicker(false);
  };

  const handleCreated = async (p: CreateConnectorResultPayload) => {
    const msg = p.reused
      ? t("connectors.create.reused", { name: p.displayName })
      : p.updated
        ? t("connectors.create.updated", { name: p.displayName })
        : t("connectors.create.success", { name: p.displayName });
    await onChanged(msg, p);
  };

  const menuItem =
    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-text-strong transition hover:bg-surface-hover";

  return (
    <div ref={wrapRef} className={`relative shrink-0 ${className}`}>
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-md bg-btnPrimary px-3 py-1.5 text-[13px] font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
        data-new-connector-button
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        {t("connectors.newMenu.button")}
        <ChevronDown className={`h-3 w-3 opacity-80 transition ${menuOpen ? "rotate-180" : ""}`} aria-hidden />
      </button>

      {menuOpen ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1.5 w-52 rounded-xl border border-border bg-surface-popover p-1 shadow-xl"
        >
          {NEW_CONNECTOR_MENU_ITEMS.map((item) => {
            const Icon = item === "fromChat" ? MessageSquarePlus : LayoutTemplate;
            const onClick =
              item === "fromChat"
                ? () => {
                    setMenuOpen(false);
                    onFromChat(buildNewConnectorChatDraft(t(NEW_CONNECTOR_CHAT_DRAFT_KEY)));
                  }
                : openPicker;
            return (
              <button
                key={item}
                type="button"
                role="menuitem"
                className={menuItem}
                data-new-connector-item={item}
                onClick={onClick}
              >
                <Icon className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
                {t(`connectors.newMenu.${item}`)}
              </button>
            );
          })}
        </div>
      ) : null}

      {/* 第 1 步：选择模板 */}
      <Modal
        open={pickerOpen}
        panelClassName="w-[min(560px,94vw)] bg-surface-popover"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-lg border border-border bg-surface-cardSolid px-4 py-2 text-xs font-medium text-text-primary hover:bg-surface-cardSolidHover"
              onClick={() => setPickerOpen(false)}
            >
              {t("connectors.newMenu.cancel")}
            </button>
            <button
              type="button"
              className="rounded-lg bg-btnPrimary px-4 py-2 text-xs font-medium text-btnPrimary-text hover:bg-btnPrimary-hover disabled:opacity-50"
              disabled={!selected}
              onClick={goNext}
            >
              {t("connectors.newMenu.next")}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-text-strong">{t("connectors.create.title")}</h3>
              <p className="mt-1 text-[12px] leading-relaxed text-text-muted">{t("connectors.create.subtitle")}</p>
            </div>
            <button
              type="button"
              className="shrink-0 rounded-md p-1 text-text-faint transition hover:bg-surface-hover hover:text-text-strong"
              aria-label={t("connectors.create.close")}
              onClick={() => setPickerOpen(false)}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
            <input
              type="text"
              autoFocus
              className="w-full rounded-lg border border-border bg-surface-card py-2 pl-8 pr-3 text-[13px] text-text-primary outline-none placeholder:text-text-faint focus:border-border-strong"
              placeholder={t("connectors.newMenu.searchTemplates")}
              value={pickerQuery}
              onChange={(e) => setPickerQuery(e.target.value)}
              aria-label={t("connectors.newMenu.searchTemplates")}
            />
          </div>
          <div role="listbox" className="max-h-[min(420px,55vh)] space-y-1.5 overflow-y-auto pr-1">
            {visibleTemplates.length === 0 ? (
              <div className="py-8 text-center text-xs text-text-faint">{t("connectors.newMenu.noTemplates")}</div>
            ) : (
              visibleTemplates.map((tpl) => {
                const active = tpl.id === selectedId;
                const live = liveIds.has(tpl.id);
                return (
                  <button
                    key={tpl.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    aria-disabled={!tpl.selectable}
                    disabled={!tpl.selectable}
                    data-template-id={tpl.id}
                    className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition ${
                      active
                        ? "border-border-strong bg-surface-hover"
                        : "border-border bg-surface-cardSolid hover:bg-surface-cardSolidHover"
                    } ${tpl.selectable ? "" : "cursor-not-allowed opacity-55"}`}
                    onClick={() => setSelectedId(tpl.id)}
                  >
                    <MarketIcon name={tpl.name} iconSrc={tpl.iconSrc} className="h-9 w-9" />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-[13px] font-semibold text-text-strong">{tpl.name}</span>
                        <span className="shrink-0 rounded border border-border px-1 py-0.5 text-[10px] text-text-faint">
                          {t("connectors.newMenu.official")}
                        </span>
                        {live ? (
                          <span className="shrink-0 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-500">
                            {t("badge.connected")}
                          </span>
                        ) : null}
                        {!tpl.selectable ? (
                          <span className="shrink-0 rounded border border-border px-1 py-0.5 text-[10px] text-text-faint">
                            {t("actions.notWired")}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-[12px] leading-[1.45] text-text-muted">
                        {tpl.description}
                      </p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </Modal>

      {/* 第 2 步：配置凭证（同模板已存在 → 更新而非新增） */}
      <CreateConnectorModal
        open={Boolean(createTarget)}
        target={createTarget}
        configPath={configPath}
        existingConnection={existing ? { name: existing.name } : null}
        onBack={
          fromPicker
            ? () => {
                setCreateTarget(null);
                setPickerOpen(true);
              }
            : undefined
        }
        onUseExisting={
          onUseConnection
            ? (name) => {
                closeCreate();
                onUseConnection(name);
              }
            : undefined
        }
        onClose={closeCreate}
        onCreated={handleCreated}
      />
    </div>
  );
}
