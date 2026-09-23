import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../../store";
import {
  createCommand,
  deleteCommand,
  fetchCommands,
  type StoredCommand,
} from "../../../services/commandsApi";

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SCOPES = ["global", "avatar", "group", "room"] as const;
type Scope = (typeof SCOPES)[number];

type Subject = { id: string; label: string };

export function CommandsSettings() {
  const { t } = useTranslation("settings");
  const apiBase = useAppStore((s) => s.apiBase);
  const apiToken = useAppStore((s) => s.apiToken);
  const [scope, setScope] = useState<Scope>("global");
  const [subjectId, setSubjectId] = useState("");
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [subjectError, setSubjectError] = useState("");
  const [commands, setCommands] = useState<StoredCommand[]>([]);
  const [loadError, setLoadError] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [formError, setFormError] = useState("");
  const [pendingDelete, setPendingDelete] = useState<StoredCommand | null>(null);

  const loadSubjects = useCallback(async (next: Scope) => {
    setSubjectError("");
    if (next === "global") {
      setSubjects([]);
      setSubjectId("");
      return;
    }
    try {
      if (next === "avatar") {
        const desktop = window.agenticxDesktop;
        if (desktop?.listAvatars) {
          const res = await desktop.listAvatars();
          const rows = (res.avatars ?? [])
            .map((item) => ({ id: String(item.id ?? "").trim(), label: String(item.name ?? item.id ?? "").trim() }))
            .filter((item) => item.id);
          setSubjects(rows);
          setSubjectId(rows[0]?.id ?? "");
          return;
        }
        const res = await fetch(`${apiBase}/api/avatars`, {
          headers: apiToken ? { "x-agx-desktop-token": apiToken } : {},
        });
        const body = (await res.json()) as { avatars?: Array<{ id?: string; name?: string }> };
        const rows = (body.avatars ?? [])
          .map((item) => ({ id: String(item.id ?? "").trim(), label: String(item.name ?? item.id ?? "").trim() }))
          .filter((item) => item.id);
        setSubjects(rows);
        setSubjectId(rows[0]?.id ?? "");
        return;
      }
      if (next === "group") {
        const res = await window.agenticxDesktop.listGroups();
        const rows = (res.groups ?? [])
          .map((item) => ({ id: String(item.id ?? "").trim(), label: String(item.name ?? item.id ?? "").trim() }))
          .filter((item) => item.id);
        setSubjects(rows);
        setSubjectId(rows[0]?.id ?? "");
        return;
      }
      const res = await window.agenticxDesktop.collabRoomList();
      if (!res.ok) {
        setSubjects([]);
        setSubjectId("");
        setSubjectError(t("commands.roomLogin"));
        return;
      }
      const rooms = Array.isArray(res.data?.rooms) ? res.data.rooms : [];
      const rows = rooms
        .map((item) => {
          const row = item as { id?: string; name?: string; title?: string };
          const id = String(row.id ?? "").trim();
          return { id, label: String(row.name ?? row.title ?? id).trim() };
        })
        .filter((item) => item.id);
      setSubjects(rows);
      setSubjectId(rows[0]?.id ?? "");
      if (rows.length === 0) setSubjectError(t("commands.roomLogin"));
    } catch {
      setSubjects([]);
      setSubjectId("");
      setSubjectError(next === "room" ? t("commands.roomLogin") : t("commands.loadFailed"));
    }
  }, [apiBase, apiToken, t]);

  const loadCommands = useCallback(async () => {
    if (!apiBase) return;
    if (scope !== "global" && !subjectId) {
      setCommands([]);
      return;
    }
    setLoadError("");
    try {
      setCommands(await fetchCommands(apiBase, apiToken, scope, subjectId));
    } catch (err) {
      setCommands([]);
      setLoadError(err instanceof Error ? err.message : t("commands.loadFailed"));
    }
  }, [apiBase, apiToken, scope, subjectId, t]);

  useEffect(() => {
    void loadSubjects(scope);
  }, [scope, loadSubjects]);

  useEffect(() => {
    void loadCommands();
  }, [loadCommands]);

  const submit = async () => {
    const cleanName = name.trim();
    const cleanInstructions = instructions.trim();
    if (!NAME_RE.test(cleanName) || cleanName.length > 64) {
      setFormError(t("commands.invalidName"));
      return;
    }
    if (cleanName === "perf") {
      setFormError(t("commands.reservedName"));
      return;
    }
    if (!cleanInstructions) {
      setFormError(t("commands.instructionsRequired"));
      return;
    }
    if (scope !== "global" && !subjectId) {
      setFormError(t("commands.subjectRequired"));
      return;
    }
    try {
      await createCommand(apiBase, apiToken, {
        scope,
        subject_id: scope === "global" ? "" : subjectId,
        name: cleanName,
        description: description.trim(),
        instructions: cleanInstructions,
      });
      setCreating(false);
      setName("");
      setDescription("");
      setInstructions("");
      setFormError("");
      await loadCommands();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("commands.loadFailed"));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {SCOPES.map((item) => (
          <button
            key={item}
            type="button"
            className={`rounded-full px-3 py-1 text-[12px] ${
              scope === item ? "bg-btnPrimary text-btnPrimary-text" : "bg-surface-hover text-text-muted"
            }`}
            onClick={() => setScope(item)}
          >
            {t(`commands.scope.${item}`)}
          </button>
        ))}
      </div>
      {scope !== "global" ? (
        subjectError ? (
          <p className="text-[12px] text-text-faint">{subjectError}</p>
        ) : (
          <select
            className="h-8 rounded-md border border-border bg-surface-card px-2 text-[12px] text-text-primary"
            value={subjectId}
            onChange={(event) => setSubjectId(event.target.value)}
            aria-label={t("commands.subject")}
          >
            {subjects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label || item.id}
              </option>
            ))}
          </select>
        )
      ) : null}
      <div className="rounded-xl border border-border">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <div>
            <div className="text-[13px] font-medium text-text-strong">{t("commands.title")}</div>
            <p className="text-[11px] text-text-faint">{t("commands.hint")}</p>
          </div>
          <button
            type="button"
            className="rounded-md bg-btnPrimary px-2.5 py-1 text-[12px] text-btnPrimary-text"
            onClick={() => {
              setFormError("");
              setCreating(true);
            }}
          >
            {t("commands.create")}
          </button>
        </div>
        {loadError ? <p className="px-3 py-2 text-[12px] text-status-error">{loadError}</p> : null}
        {commands.length === 0 ? (
          <div className="px-3 py-10 text-center">
            <div className="text-[13px] text-text-strong">{t("commands.emptyTitle")}</div>
            <p className="mt-1 text-[12px] text-text-faint">{t("commands.emptyHint")}</p>
          </div>
        ) : (
          <ul>
            {commands.map((item) => (
              <li key={item.id} className="flex items-center gap-2 border-t border-border px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[12px] text-text-strong">/{item.name}</div>
                  {item.description ? <div className="truncate text-[11px] text-text-faint">{item.description}</div> : null}
                </div>
                {pendingDelete?.id === item.id ? (
                  <div className="flex items-center gap-1">
                    <button type="button" className="rounded px-2 py-1 text-[11px] text-text-muted" onClick={() => setPendingDelete(null)}>
                      {t("commands.cancel")}
                    </button>
                    <button
                      type="button"
                      className="rounded bg-status-error/15 px-2 py-1 text-[11px] text-status-error"
                      onClick={() => {
                        void deleteCommand(apiBase, apiToken, item.id, scope, subjectId).then(() => {
                          setPendingDelete(null);
                          void loadCommands();
                        });
                      }}
                    >
                      {t("commands.delete")}
                    </button>
                  </div>
                ) : (
                  <button type="button" className="rounded px-2 py-1 text-[11px] text-text-muted hover:bg-surface-hover" onClick={() => setPendingDelete(item)}>
                    {t("commands.delete")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {creating ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl border border-border bg-surface-panel p-4">
            <div className="mb-3 text-[14px] font-medium text-text-strong">{t("commands.createTitle")}</div>
            <label className="mb-2 block text-[12px] text-text-muted">
              {t("commands.name")}
              <input
                className="mt-1 w-full rounded-md border border-border bg-surface-card px-2 py-1.5 text-[13px] text-text-primary"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="mb-2 block text-[12px] text-text-muted">
              {t("commands.description")}
              <input
                className="mt-1 w-full rounded-md border border-border bg-surface-card px-2 py-1.5 text-[13px] text-text-primary"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <label className="mb-2 block text-[12px] text-text-muted">
              {t("commands.instructions")}
              <textarea
                className="mt-1 h-28 w-full rounded-md border border-border bg-surface-card px-2 py-1.5 text-[13px] text-text-primary"
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
              />
            </label>
            {formError ? <p className="mb-2 text-[12px] text-status-error">{formError}</p> : null}
            <div className="flex justify-end gap-2">
              <button type="button" className="rounded-md px-3 py-1.5 text-[12px] text-text-muted" onClick={() => setCreating(false)}>
                {t("commands.cancel")}
              </button>
              <button type="button" className="rounded-md bg-btnPrimary px-3 py-1.5 text-[12px] text-btnPrimary-text" onClick={() => void submit()}>
                {t("commands.confirm")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
