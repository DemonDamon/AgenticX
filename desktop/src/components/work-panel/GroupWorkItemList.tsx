/**
 * Group work-item list for WorkPanel summary.
 *
 * Author: Damon Li
 */

import { useState } from "react";
import type { Avatar } from "../../store";
import {
  workItemBlockerHint,
  workItemStatusLabel,
  type WorkItem,
  type WorkItemStatus,
} from "../../utils/work-items";

export function visibleWorkItemActions(
  status: WorkItemStatus,
): Array<"accept" | "pause" | "resume"> {
  if (status === "submitted") return ["accept", "pause"];
  if (status === "paused") return ["resume"];
  if (status === "open" || status === "in_progress") return ["pause"];
  return [];
}

type Props = {
  groupId: string;
  items: WorkItem[];
  avatars: Avatar[];
  metaLeaderLabel: string;
  errorText?: string;
  onAccept: (item: WorkItem) => void;
  onPause: (item: WorkItem) => void;
  onResume: (item: WorkItem) => void;
  onOpenOwner: (item: WorkItem) => void;
  onCreate: (input: { title: string; owner_kind: WorkItem["owner_kind"]; owner_id: string }) => void;
};

function ownerLabel(item: WorkItem, avatars: Avatar[], metaLeaderLabel: string): string {
  if (item.owner_kind === "human") return "用户";
  if (item.owner_kind === "meta") return metaLeaderLabel;
  return avatars.find((a) => a.id === item.owner_id)?.name || item.owner_id || "分身";
}

export function GroupWorkItemList({
  items,
  avatars,
  metaLeaderLabel,
  errorText,
  onAccept,
  onPause,
  onResume,
  onOpenOwner,
  onCreate,
}: Props) {
  const [title, setTitle] = useState("");
  const [ownerKey, setOwnerKey] = useState("human:");

  const submitCreate = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const [kind, id] = ownerKey.split(":");
    const owner_kind = (kind === "avatar" || kind === "meta" ? kind : "human") as WorkItem["owner_kind"];
    onCreate({ title: trimmed, owner_kind, owner_id: id || "" });
    setTitle("");
  };

  return (
    <div className="space-y-2">
      {errorText ? <div className="px-1 text-[11px] text-text-muted">{errorText}</div> : null}
      {items.length === 0 ? (
        <div className="px-1 py-1 text-[12px] text-text-faint">暂无事项</div>
      ) : (
        <ul className="space-y-0.5">
          {items.map((item) => {
            const actions = visibleWorkItemActions(item.status);
            const name = ownerLabel(item, avatars, metaLeaderLabel);
            const blockerHint = workItemBlockerHint(item, items);
            const ownerClickable = item.owner_kind === "avatar" || item.owner_kind === "meta";
            const statusClass =
              item.status === "in_progress"
                ? "text-[rgb(var(--theme-color-rgb,59,130,246))]"
                : item.status === "accepted"
                  ? "text-text-strong"
                  : "text-text-muted";
            return (
              <li key={item.id} className="flex items-start gap-2 rounded px-1 py-1">
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] leading-snug text-text-strong">{item.title}</div>
                  <div className="mt-0.5 text-[11px] text-text-faint">
                    <span className={statusClass}>{workItemStatusLabel(item.status)}</span>
                    <span> · </span>
                    {ownerClickable ? (
                      <button
                        type="button"
                        className="text-text-muted hover:text-text-strong"
                        onClick={() => onOpenOwner(item)}
                      >
                        {name}
                      </button>
                    ) : (
                      <span>{name}</span>
                    )}
                    {blockerHint ? (
                      <>
                        <span> · </span>
                        <span>{blockerHint}</span>
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {actions.includes("accept") ? (
                    <button
                      type="button"
                      className="rounded px-1.5 py-0.5 text-[11px] bg-[var(--ui-btn-primary-bg)] text-[var(--ui-btn-primary-text)] hover:bg-[var(--ui-btn-primary-bg-hover,var(--ui-btn-primary-bg))]"
                      onClick={() => onAccept(item)}
                    >
                      验收
                    </button>
                  ) : null}
                  {actions.includes("pause") ? (
                    <button
                      type="button"
                      className="text-[11px] text-text-muted hover:text-text-strong"
                      onClick={() => onPause(item)}
                    >
                      暂停
                    </button>
                  ) : null}
                  {actions.includes("resume") ? (
                    <button
                      type="button"
                      className="text-[11px] text-text-muted hover:text-text-strong"
                      onClick={() => onResume(item)}
                    >
                      恢复
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex items-center gap-1 px-1">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitCreate();
          }}
          placeholder="事项标题"
          className="min-w-0 flex-1 rounded border border-border bg-surface-card px-1.5 py-0.5 text-[12px] text-text-strong outline-none"
        />
        <select
          value={ownerKey}
          onChange={(e) => setOwnerKey(e.target.value)}
          className="max-w-[7.5rem] appearance-none rounded border border-border bg-surface-card py-0.5 pl-1.5 pr-6 text-[11px] text-text-muted"
        >
          <option value="human:">用户</option>
          <option value="meta:__meta__">{metaLeaderLabel}</option>
          {avatars.map((av) => (
            <option key={av.id} value={`avatar:${av.id}`}>
              {av.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-[11px] bg-[var(--ui-btn-primary-bg)] text-[var(--ui-btn-primary-text)] hover:bg-[var(--ui-btn-primary-bg-hover,var(--ui-btn-primary-bg))]"
          onClick={submitCreate}
        >
          创建
        </button>
      </div>
    </div>
  );
}
