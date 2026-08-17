import type { AtMentionCandidate } from "../utils/at-mention-display";
import {
  atMentionIconTone,
  atMentionPrimaryText,
  atMentionSecondaryText,
  browseTrailLabel,
  groupAtMentionCandidates,
} from "../utils/at-mention-display";
import { ComposerRefIcon, type ComposerRefIconKind } from "./icons/ComposerRefIcon";

export type AtMentionBrowseState = {
  taskspaceId: string;
  taskspaceLabel: string;
  path: string;
};

type FolderCandidate = Extract<AtMentionCandidate, { kind: "taskspace" | "dir" }>;

type Props = {
  query: string;
  candidates: AtMentionCandidate[];
  /** Non-null while drilled into a directory; suppresses per-row path hints. */
  browse: AtMentionBrowseState | null;
  onPick: (item: AtMentionCandidate) => void;
  onEnterDir: (item: FolderCandidate) => void;
  onInsertDir: (item: FolderCandidate) => void;
  onLeaveBrowse: () => void;
};

function pickerIconKind(item: AtMentionCandidate): ComposerRefIconKind {
  const tone = atMentionIconTone(item);
  if (tone === "avatar" || tone === "generic") return "file";
  return tone;
}

function isFolderCandidate(item: AtMentionCandidate): item is FolderCandidate {
  return item.kind === "taskspace" || item.kind === "dir";
}

function candidateKey(item: AtMentionCandidate): string {
  return item.kind === "avatar"
    ? `avatar:${item.avatarId}`
    : `${item.kind}:${item.taskspaceId}:${item.path}`;
}

function Chevron({ dir = "right" }: { dir?: "right" | "left" }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="h-[12px] w-[12px]">
      <path
        d={dir === "right" ? "M6 3.5L10.5 8L6 12.5" : "M10 3.5L5.5 8L10 12.5"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AtMentionIcon({ item }: { item: AtMentionCandidate }) {
  if (item.kind === "avatar") {
    const src = String(item.avatarUrl || "").trim();
    if (src) {
      return <img src={src} alt="" className="h-[15px] w-[15px] shrink-0 rounded-full object-cover" />;
    }
    return (
      <span className="flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full bg-surface-hover text-[9px] leading-none text-text-muted">
        {(item.label || "?").slice(0, 1)}
      </span>
    );
  }
  return (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center">
      <ComposerRefIcon kind={pickerIconKind(item)} className="agx-composer-inline-chip-icon h-4 w-4" />
    </span>
  );
}

function AtMentionRow({
  item,
  showPathHint,
  onActivate,
  onInsertDir,
}: {
  item: AtMentionCandidate;
  showPathHint: boolean;
  onActivate: (item: AtMentionCandidate) => void;
  onInsertDir: (item: FolderCandidate) => void;
}) {
  const primary = atMentionPrimaryText(item);
  const secondary = showPathHint ? atMentionSecondaryText(item) : "";
  const folder = isFolderCandidate(item);
  return (
    <div
      role="option"
      aria-selected={false}
      className="group flex items-center rounded-md pr-1 hover:bg-surface-hover focus-within:bg-surface-hover"
    >
      <button
        type="button"
        title={item.kind === "avatar" ? primary : item.path}
        className="flex min-w-0 flex-1 items-center gap-2 px-2 py-[3px] text-left outline-none"
        // Keep the caret in the composer so the @ token stays replaceable.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onActivate(item)}
      >
        <AtMentionIcon item={item} />
        <span className="max-w-[70%] shrink-0 truncate text-[13px] leading-[22px] text-text-strong">
          {primary}
        </span>
        {secondary ? (
          <span className="min-w-0 truncate text-[12px] leading-[22px] text-text-faint">
            {secondary}
          </span>
        ) : null}
      </button>
      {folder ? (
        <>
          <button
            type="button"
            title="把整个目录作为引用带入对话"
            className="shrink-0 rounded px-1.5 py-0.5 text-[11px] leading-[18px] text-text-faint opacity-60 outline-none transition hover:bg-surface-card-strong hover:text-text-primary group-hover:opacity-100 focus-visible:opacity-100"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onInsertDir(item)}
          >
            引用
          </button>
          <span className="shrink-0 pl-0.5 pr-0.5 text-text-faint">
            <Chevron />
          </span>
        </>
      ) : null}
    </div>
  );
}

export function AtMentionPicker({
  query,
  candidates,
  browse,
  onPick,
  onEnterDir,
  onInsertDir,
  onLeaveBrowse,
}: Props) {
  const { avatars, folders, files } = groupAtMentionCandidates(candidates);
  // Hairline dividers instead of group captions: icons already carry the type.
  const groups = [avatars, folders, files].filter((group) => group.length > 0);
  // While browsing, the breadcrumb already states the location — drop per-row hints.
  const showPathHint = !browse;

  const activate = (item: AtMentionCandidate) => {
    if (isFolderCandidate(item)) onEnterDir(item);
    else onPick(item);
  };

  return (
    <div
      className="absolute bottom-full left-0 z-30 mb-2 w-max min-w-[248px] max-w-[min(100%,440px)] overflow-hidden rounded-xl border border-border bg-surface-panel shadow-[0_10px_32px_rgba(0,0,0,0.3)] backdrop-blur-xl"
      role="listbox"
      aria-label="引用候选"
    >
      {browse ? (
        <button
          type="button"
          title="返回上一级"
          className="flex w-full items-center gap-1.5 border-b border-border/60 px-2 py-1.5 text-left outline-none transition-colors hover:bg-surface-hover"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onLeaveBrowse}
        >
          <span className="shrink-0 text-text-muted">
            <Chevron dir="left" />
          </span>
          <span className="min-w-0 truncate text-[12px] leading-[18px] text-text-muted">
            {browseTrailLabel(browse.taskspaceLabel, browse.path)}
          </span>
        </button>
      ) : null}
      {candidates.length === 0 ? (
        <div className="px-3 py-2 text-[12px] leading-5 text-text-faint">
          {browse ? "这个目录是空的" : `未找到匹配对象${query ? `：${query}` : ""}`}
        </div>
      ) : (
        <div className="max-h-[268px] overflow-y-auto overscroll-contain">
          {groups.map((group, index) => (
            <div
              key={group[0].kind}
              className={index === 0 ? "p-1" : "border-t border-border/60 p-1"}
            >
              {group.map((item) => (
                <AtMentionRow
                  key={candidateKey(item)}
                  item={item}
                  showPathHint={showPathHint}
                  onActivate={activate}
                  onInsertDir={onInsertDir}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
