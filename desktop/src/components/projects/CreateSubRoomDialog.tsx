import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

type Person = { id: string; name: string };

type Props = {
  open: boolean;
  humans: Person[];
  agents: Person[];
  selfUserId: string;
  seedCount: number;
  submitting: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (input: {
    title: string;
    memberUserIds: { user_id: string; display_name: string }[];
    agentIds: string[];
  }) => void;
};

const TITLE_MAX = 20;

export function CreateSubRoomDialog({
  open,
  humans,
  agents,
  selfUserId,
  seedCount,
  submitting,
  error,
  onClose,
  onSubmit,
}: Props) {
  const { t } = useTranslation("projects");
  const [title, setTitle] = useState("");
  const [pickedHumans, setPickedHumans] = useState<string[]>([]);
  const [pickedAgents, setPickedAgents] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setPickedHumans(selfUserId ? [selfUserId] : []);
    setPickedAgents([]);
  }, [open, selfUserId]);

  if (!open) return null;

  const toggle = (id: string, kind: "human" | "agent") => {
    if (kind === "human" && id === selfUserId) return;
    const update = kind === "human" ? setPickedHumans : setPickedAgents;
    update((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed || submitting) return;
    const names = new Map(humans.map((person) => [person.id, person.name]));
    onSubmit({
      title: trimmed,
      memberUserIds: pickedHumans
        .filter((id) => id !== selfUserId)
        .map((id) => ({ user_id: id, display_name: names.get(id) ?? id })),
      agentIds: pickedAgents,
    });
  };

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="agx-sub-room-title"
        className="flex max-h-[min(640px,calc(100vh-32px))] w-full max-w-[480px] flex-col overflow-hidden rounded-xl border border-border bg-surface-base shadow-2xl"
      >
        <div className="border-b border-border px-4 py-3">
          <h3 id="agx-sub-room-title" className="text-sm font-semibold text-text-strong">
            {t("sub.create")}
          </h3>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <label className="block text-[13px] text-text-strong" htmlFor="agx-sub-room-name">
            {t("sub.name")}
          </label>
          <input
            id="agx-sub-room-name"
            value={title}
            maxLength={TITLE_MAX}
            onChange={(event) => setTitle(event.target.value.slice(0, TITLE_MAX))}
            className="mt-1 w-full rounded-md border border-border bg-surface-card px-2 py-1.5 text-[13px] text-text-primary outline-none"
          />
          <div className="mt-1 text-right text-[11px] tabular-nums text-text-faint">
            {title.length}/{TITLE_MAX}
          </div>
          <div className="mt-4 text-[13px] text-text-strong">{t("sub.members")}</div>
          <div className="mt-1 space-y-1">
            {humans.map((person) => {
              const locked = person.id === selfUserId;
              const checked = locked || pickedHumans.includes(person.id);
              return (
                <label key={person.id} className="flex items-center gap-2 rounded-md px-1 py-1 text-[13px] text-text-primary">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={locked}
                    onChange={() => toggle(person.id, "human")}
                  />
                  <span className="truncate">{person.name}</span>
                </label>
              );
            })}
          </div>
          {agents.length > 0 ? (
            <>
              <div className="mt-4 text-[13px] text-text-strong">{t("sub.experts")}</div>
              <div className="mt-1 space-y-1">
                {agents.map((person) => {
                  const checked = pickedAgents.includes(person.id);
                  return (
                    <label key={person.id} className="flex items-center gap-2 rounded-md px-1 py-1 text-[13px] text-text-primary">
                      <input type="checkbox" checked={checked} onChange={() => toggle(person.id, "agent")} />
                      <span className="truncate">{person.name}</span>
                    </label>
                  );
                })}
              </div>
            </>
          ) : null}
          {seedCount > 0 ? (
            <p className="mt-4 text-[12px] text-text-muted">{t("sub.seedCount", { count: seedCount })}</p>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="px-4 pb-2 text-[12px] text-rose-400">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-sm text-text-muted hover:bg-surface-hover"
            onClick={onClose}
          >
            {t("dialog.cancel")}
          </button>
          <button
            type="button"
            disabled={!title.trim() || submitting}
            aria-busy={submitting}
            className="rounded-md bg-[var(--ui-btn-primary-bg)] px-3 py-1.5 text-sm font-medium text-[var(--ui-btn-primary-text)] hover:bg-[var(--ui-btn-primary-bg-hover,var(--ui-btn-primary-bg))] disabled:cursor-not-allowed disabled:opacity-40"
            onClick={submit}
          >
            {submitting ? t("submitting") : t("dialog.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
