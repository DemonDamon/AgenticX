import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText } from "lucide-react";
import { HoverTip } from "../ds/HoverTip";
import { usePaneNavigation } from "../../hooks/usePaneNavigation";
import { avatarBgClass, avatarFgClass, resolveAvatarPaletteKey } from "../../utils/avatar-color";
import {
  executionLabelKey,
  type EnterpriseAgentCard,
} from "../../utils/ma-pane";
import { EnterpriseAgentDrawer } from "./EnterpriseAgentDrawer";

type Props = { agents: EnterpriseAgentCard[] };

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2 && parts[0] && parts[1]) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export function EnterpriseAgentSection({ agents }: Props): JSX.Element | null {
  const { t } = useTranslation("sidebar");
  const { openManagedAgentPane } = usePaneNavigation();
  const [drawerAgentId, setDrawerAgentId] = useState<string | null>(null);
  if (agents.length === 0) return null;

  return (
    <section className="mt-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium text-text-strong">{t("gallery.enterprise.title")}</h3>
        <span className="text-xs text-text-muted">{agents.length}</span>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {agents.map((agent) => {
          const disabled = agent.executionTarget === "desktop_worker" && agent.defaultEnvironment === null;
          const color = resolveAvatarPaletteKey(agent.id);
          return (
            <div
              key={agent.id}
              data-testid="enterprise-agent-card"
              data-disabled={disabled ? "true" : "false"}
              className={`rounded-xl border border-border bg-surface-card p-4 ${
                disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-surface-hover"
              }`}
              onClick={() => {
                if (disabled) return;
                openManagedAgentPane(agent);
              }}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${avatarBgClass(color)} ${avatarFgClass(color)}`}
                >
                  {initials(agent.displayName)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-sm font-medium text-text-strong">{agent.displayName}</p>
                    <HoverTip label={t("gallery.enterprise.viewDefinition")}>
                      <button
                        type="button"
                        aria-label={t("gallery.enterprise.viewDefinition")}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-card-strong hover:text-text-strong"
                        onClick={(event) => {
                          event.stopPropagation();
                          setDrawerAgentId(agent.id);
                        }}
                      >
                        <FileText className="h-4 w-4" />
                      </button>
                    </HoverTip>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className="rounded-md bg-surface-card-strong px-1.5 py-0.5 text-[10px] text-text-strong">
                      {t("gallery.enterprise.badge")}
                    </span>
                    {agent.routingMode === "pinned" ? (
                      <HoverTip label={t("gallery.enterprise.pinnedHint")}>
                        <span className="text-xs text-text-muted">
                          {t("gallery.enterprise.version", { version: agent.effectiveVersion })}
                        </span>
                      </HoverTip>
                    ) : (
                      <span className="text-xs text-text-muted">
                        {t("gallery.enterprise.version", { version: agent.effectiveVersion })}
                      </span>
                    )}
                    <span className="text-xs text-text-muted">{t(executionLabelKey(agent.executionTarget))}</span>
                    {agent.ownedByMe ? (
                      <span className="text-xs text-text-muted">{t("gallery.enterprise.mine")}</span>
                    ) : null}
                  </div>
                  {disabled ? (
                    <p className="mt-2 text-xs text-text-muted">{t("gallery.enterprise.noEnvironment")}</p>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {drawerAgentId ? (
        <EnterpriseAgentDrawer agentId={drawerAgentId} onClose={() => setDrawerAgentId(null)} />
      ) : null}
    </section>
  );
}
