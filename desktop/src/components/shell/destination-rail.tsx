import type { LucideIcon } from "lucide-react";
import {
  CirclePlay,
  FileDiff,
  FolderOpen,
  Globe,
  ListTodo,
  Share2,
  Terminal,
  X,
} from "lucide-react";
import { ScratchChatIcon } from "../work-panel/ScratchChatIcon";
import { HoverTip } from "../ds/HoverTip";
import { workspaceToolLocked } from "../../utils/fresh-task-workspace";
import { useTranslation } from "react-i18next";

/** Right-edge tools. Same set as the work-panel plus menu. */
export type DestinationKind =
  | "summary"
  | "scratch"
  | "changes"
  | "browser"
  | "graph"
  | "timeline"
  | "terminal"
  | "workspace";

type DestinationDef = {
  kind: DestinationKind;
  icon: LucideIcon | typeof ScratchChatIcon;
  labelKey: string;
  subtitleKey: string;
};

export const DESTINATION_ITEMS: DestinationDef[] = [
  { kind: "summary", icon: ListTodo, labelKey: "work.tabSummary", subtitleKey: "work.subtitleSummary" },
  { kind: "scratch", icon: ScratchChatIcon, labelKey: "work.tabScratch", subtitleKey: "work.subtitleScratch" },
  { kind: "changes", icon: FileDiff, labelKey: "work.tabChanges", subtitleKey: "work.subtitleChanges" },
  { kind: "browser", icon: Globe, labelKey: "work.tabBrowser", subtitleKey: "work.subtitleBrowser" },
  { kind: "graph", icon: Share2, labelKey: "work.tabGraph", subtitleKey: "work.subtitleGraph" },
  { kind: "timeline", icon: CirclePlay, labelKey: "work.tabTimeline", subtitleKey: "work.subtitleTimeline" },
  { kind: "terminal", icon: Terminal, labelKey: "work.tabTerminal", subtitleKey: "work.subtitleTerminal" },
  { kind: "workspace", icon: FolderOpen, labelKey: "work.tabWorkspace", subtitleKey: "work.subtitleWorkspace" },
];

type RailProps = {
  activeKind: DestinationKind | null;
  freshTask?: boolean;
  onSelect: (kind: DestinationKind) => void;
};

export function DestinationRail({ activeKind, freshTask = false, onSelect }: RailProps) {
  const { t } = useTranslation("workspace");
  return (
    <aside
      className="relative z-[60] flex w-10 shrink-0 flex-col items-center gap-1 self-stretch bg-transparent px-1 py-2"
      aria-label={t("work.destinationRail")}
    >
      {DESTINATION_ITEMS.map((item) => {
        const Icon = item.icon;
        const active = activeKind === item.kind;
        const locked = workspaceToolLocked(item.kind, freshTask);
        const label = t(item.labelKey);
        const button = (
          <button
            type="button"
            className={`flex h-8 w-8 items-center justify-center rounded-xl transition-colors ${
              locked
                ? "cursor-default text-text-faint"
                : active
                  ? "bg-surface-card-strong text-text-strong"
                  : "text-text-muted hover:bg-surface-hover hover:text-text-strong"
            }`}
            aria-label={label}
            aria-disabled={locked || undefined}
            aria-pressed={active}
            onClick={() => {
              if (locked) return;
              onSelect(item.kind);
            }}
          >
            <Icon className="h-4 w-4" strokeWidth={1.7} aria-hidden />
          </button>
        );
        return locked ? (
          <HoverTip key={item.kind} label={t("work.startLockedHint")}>
            {button}
          </HoverTip>
        ) : (
          <HoverTip key={item.kind} label={label}>
            {button}
          </HoverTip>
        );
      })}
    </aside>
  );
}

type ChooserProps = {
  onClose: () => void;
  freshTask?: boolean;
  onSelect: (kind: DestinationKind) => void;
};

export function DestinationChooser({ onClose, freshTask = false, onSelect }: ChooserProps) {
  const { t } = useTranslation("workspace");
  return (
    <div className="flex h-full min-h-0 w-[300px] shrink-0 flex-col bg-transparent">
      <div className="flex h-10 shrink-0 items-center justify-end px-2">
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:bg-surface-hover hover:text-text-strong"
          aria-label={t("work.closeDestination")}
          onClick={onClose}
        >
          <X className="h-4 w-4" strokeWidth={1.7} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        <div className="mx-auto w-full max-w-sm pt-6">
          <h2 className="text-[15px] font-medium text-text-strong">{t("work.chooseDestination")}</h2>
          <p className="mt-1 text-[13px] leading-5 text-text-muted">{t("work.chooseDestinationHint")}</p>
          <div className="mt-4 grid gap-2">
            {DESTINATION_ITEMS.map((item) => {
              const Icon = item.icon;
              const locked = workspaceToolLocked(item.kind, freshTask);
              const button = (
                <button
                  type="button"
                  className={`group flex min-h-16 w-full items-center gap-3 rounded-xl border border-border bg-surface-base p-3 text-left ${
                    locked ? "cursor-default" : "transition-colors hover:bg-surface-hover"
                  }`}
                  aria-disabled={locked || undefined}
                  onClick={() => {
                    if (locked) return;
                    onSelect(item.kind);
                  }}
                >
                  <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-hover ${locked ? "text-text-faint" : "text-text-muted"}`}>
                    <Icon className="h-4 w-4" strokeWidth={1.7} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[13px] font-medium ${locked ? "text-text-faint" : "text-text-strong"}`}>{t(item.labelKey)}</span>
                    <span className="mt-0.5 block text-[12px] leading-5 text-text-muted">{t(item.subtitleKey)}</span>
                  </span>
                </button>
              );
              return locked ? (
                <HoverTip key={item.kind} label={t("work.startLockedHint")} className="w-full">
                  {button}
                </HoverTip>
              ) : (
                <span key={item.kind}>{button}</span>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

type Suggestion = { title: string; description: string; prompt: string };

export function EmptyTaskSuggestions({ onPick }: { onPick: (prompt: string) => void }) {
  const { t } = useTranslation("chat");
  const suggestions = t("empty.suggestions", { returnObjects: true }) as Suggestion[];
  if (!Array.isArray(suggestions)) return null;
  return (
    <div className="mx-auto mt-4 grid w-full max-w-[640px] grid-cols-2 gap-2">
      {suggestions.map((item) => (
        <button
          key={item.title}
          type="button"
          className="rounded-xl border border-border bg-surface-base px-3 py-2.5 text-left transition-colors hover:bg-surface-hover"
          onClick={() => onPick(item.prompt)}
        >
          <span className="block text-[13px] font-medium text-text-strong">{item.title}</span>
          <span className="mt-0.5 block text-[12px] leading-5 text-text-muted">{item.description}</span>
        </button>
      ))}
    </div>
  );
}
