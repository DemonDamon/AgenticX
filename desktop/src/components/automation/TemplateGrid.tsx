import {
  Newspaper,
  Languages,
  FileText,
  GitPullRequest,
  CalendarCheck,
  GraduationCap,
  BarChart3,
  Shield,
  Bell,
  type LucideIcon,
} from "lucide-react";
import { AUTOMATION_TEMPLATES } from "./templates";
import { useTranslation } from "react-i18next";
import type { AutomationTemplate } from "./types";

const ICON_MAP: Record<string, LucideIcon> = {
  Newspaper,
  Languages,
  FileText,
  GitPullRequest,
  CalendarCheck,
  GraduationCap,
  BarChart3,
  Shield,
  Bell,
};

interface Props {
  onSelect: (template: AutomationTemplate) => void;
}

/** Same hover as marketplace cards: opaque fill so the lift shadow stays outside the card. */
const TEMPLATE_CARD_BASE =
  "agx-market-card relative flex items-start gap-3 rounded-lg border border-border bg-surface-cardSolid px-3 py-2.5 text-left outline-none";
const TEMPLATE_CARD_IDLE =
  "border-border focus-visible:border-[rgba(var(--theme-color-rgb,59,130,246),0.5)] focus-visible:ring-1 focus-visible:ring-[rgba(var(--theme-color-rgb,59,130,246),0.22)]";

export function TemplateGrid({ onSelect }: Props) {
  const { t } = useTranslation("workspace");
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-[0.06em] text-text-subtle">
        {t("automation.fromTemplate")}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {AUTOMATION_TEMPLATES.map((tpl) => {
          const Icon = ICON_MAP[tpl.icon] ?? Bell;
          return (
            <div
              key={tpl.id}
              role="button"
              tabIndex={0}
              className={`cursor-pointer ${TEMPLATE_CARD_BASE} ${TEMPLATE_CARD_IDLE}`}
              onClick={() => onSelect(tpl)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(tpl);
                }
              }}
            >
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-panel">
                <Icon className="h-4 w-4 text-text-subtle" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-text-strong">{t(`automation.templates.${tpl.id}.name`)}</div>
                <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-text-muted">
                  {t(`automation.templates.${tpl.id}.description`)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
