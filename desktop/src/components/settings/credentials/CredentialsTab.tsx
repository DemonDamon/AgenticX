import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Modal } from "../../ds/Modal";
import { Toast } from "../../ds/Toast";
import { useAppStore } from "../../../store";
import {
  CREDENTIAL_NAME_RE,
  deleteCredential,
  listCredentials,
  splitCredentialReference,
  upsertCredential,
  type CredentialRecord,
  type CredentialWriteBody,
} from "./api";

const PRIMARY_BUTTON_CLASS =
  "inline-flex items-center justify-center rounded-md bg-[var(--ui-btn-primary-bg)] px-3 py-1.5 text-xs font-medium text-[var(--ui-btn-primary-text)] transition hover:bg-[var(--ui-btn-primary-bg-hover)] disabled:cursor-not-allowed disabled:opacity-40";

const SECONDARY_BUTTON_CLASS =
  "rounded-md border border-border px-3 py-1.5 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-strong disabled:opacity-40";

const FIELD_CLASS =
  "mt-1 w-full rounded-md border border-border bg-surface-card-strong px-2 py-1.5 text-sm text-text-primary outline-none placeholder:text-text-faint";

type EditorState = {
  mode: "create" | "edit";
  name: string;
  value: string;
  description: string;
  error: string;
};

function referenceLabel(ref: string, t: TFunction<"settings">): string | null {
  const parts = splitCredentialReference(ref);
  if (!parts) return null;
  return parts.kind === "mcp"
    ? String(t("credentials.refMcp", { name: parts.name }))
    : String(t("credentials.refProvider", { name: parts.name }));
}

function formatUpdatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.trim() || "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function credentialRefText(name: string): string {
  return "${cred:" + name + "}";
}

export function CredentialsTab() {
  const { t } = useTranslation("settings");
  const { t: tCommon } = useTranslation("common");
  const apiToken = useAppStore((s) => s.apiToken);
  const [items, setItems] = useState<CredentialRecord[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<CredentialRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [copiedName, setCopiedName] = useState<string | null>(null);
  const [toastOpen, setToastOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState("");

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    setToastOpen(true);
  }, []);

  const reload = useCallback(async () => {
    const list = await listCredentials(apiToken);
    setItems(list);
    setLoadError("");
  }, [apiToken]);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setLoadError("");
    listCredentials(apiToken)
      .then((list) => {
        if (!cancelled) setItems(list);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : t("credentials.loadFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [apiToken, t]);

  useEffect(() => {
    if (!copiedName) return;
    const timer = window.setTimeout(() => setCopiedName(null), 1600);
    return () => window.clearTimeout(timer);
  }, [copiedName]);

  const openCreate = () => {
    setEditor({ mode: "create", name: "", value: "", description: "", error: "" });
  };

  const openEdit = (item: CredentialRecord) => {
    setEditor({
      mode: "edit",
      name: item.name,
      value: "",
      description: item.description,
      error: "",
    });
  };

  const closeEditor = () => {
    if (saving) return;
    setEditor(null);
  };

  const trimmedName = editor?.name.trim() ?? "";
  const nameOk = CREDENTIAL_NAME_RE.test(trimmedName);
  const nameInvalid = trimmedName.length > 0 && !nameOk;
  const valueOk = editor?.mode === "edit" || (editor?.value.trim().length ?? 0) > 0;
  const canSave = Boolean(editor) && nameOk && valueOk && !saving;

  const save = async () => {
    if (!editor || !canSave) return;
    const payload: CredentialWriteBody = {
      description: editor.description.trim(),
    };
    if (editor.mode === "create" || editor.value.trim()) {
      payload.value = editor.value;
    }
    setSaving(true);
    setEditor({ ...editor, error: "" });
    try {
      await upsertCredential(apiToken, trimmedName, payload);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t("credentials.saveFailed");
      setEditor((current) => (current ? { ...current, error: message } : current));
      return;
    } finally {
      setSaving(false);
    }
    setEditor(null);
    showToast(t("credentials.saved"));
    try {
      await reload();
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : t("credentials.loadFailed"));
    }
  };

  const copyReference = async (name: string) => {
    try {
      await navigator.clipboard.writeText(credentialRefText(name));
      setCopiedName(name);
    } catch {
      showToast(t("credentials.copyFailed"));
    }
  };

  const retryLoad = () => {
    setItems(null);
    setLoadError("");
    void reload().catch((err: unknown) => {
      setLoadError(err instanceof Error ? err.message : t("credentials.loadFailed"));
    });
  };

  const confirmDelete = async () => {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await deleteCredential(apiToken, pendingDelete.name);
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : t("credentials.deleteFailed"));
      return;
    } finally {
      setDeleting(false);
    }
    setPendingDelete(null);
    showToast(t("credentials.deleted"));
    try {
      await reload();
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : t("credentials.loadFailed"));
    }
  };

  const deleteLabels = (pendingDelete?.referenced_by ?? [])
    .map((ref) => referenceLabel(ref, t))
    .filter((label): label is string => Boolean(label));

  return (
    <div className="space-y-4">
      {items !== null && loadError ? <p className="text-sm text-rose-400">{loadError}</p> : null}

      {items === null && !loadError ? (
        <p className="text-sm text-text-muted">{t("credentials.loading")}</p>
      ) : items === null ? (
        <div className="space-y-3">
          <p className="text-sm text-rose-400">{loadError}</p>
          <button type="button" className={SECONDARY_BUTTON_CLASS} onClick={retryLoad}>
            {t("credentials.retry")}
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
          <p className="text-sm leading-relaxed text-text-muted">{t("credentials.empty")}</p>
          <button type="button" className={`${PRIMARY_BUTTON_CLASS} mt-4`} onClick={openCreate}>
            {t("credentials.add")}
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-3">
            <p className="text-[13px] leading-relaxed text-text-muted">{t("credentials.intro")}</p>
            <button type="button" className={`${PRIMARY_BUTTON_CLASS} shrink-0`} onClick={openCreate}>
              {t("credentials.add")}
            </button>
          </div>
          <ul className="space-y-2">
            {items.map((item) => {
              const labels = item.referenced_by
                .map((ref) => referenceLabel(ref, t))
                .filter((label): label is string => Boolean(label));
              return (
                <li key={item.name} className="rounded-md border border-border bg-surface-card px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="truncate font-mono text-sm font-medium text-text-strong">{item.name}</div>
                      <div className="text-xs text-text-muted">
                        <span className="text-text-faint">{t("credentials.description")} · </span>
                        {item.description.trim() || t("credentials.noDescription")}
                      </div>
                      <div className="text-xs text-text-muted">
                        <span className="text-text-faint">{t("credentials.refs")} · </span>
                        {labels.length > 0 ? labels.join("、") : t("credentials.unreferenced")}
                      </div>
                      <div className="text-[11px] text-text-faint">
                        {t("credentials.updated")} · {formatUpdatedAt(item.updated_at)}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        className="rounded-md border border-border px-2 py-1 text-[11px] text-text-subtle transition hover:bg-surface-hover hover:text-text-primary"
                        onClick={() => void copyReference(item.name)}
                      >
                        {t("credentials.copy")}
                      </button>
                      {copiedName === item.name ? (
                        <span className="text-[11px] text-text-muted">{t("credentials.copied")}</span>
                      ) : null}
                      <button
                        type="button"
                        className="rounded-md border border-border px-2 py-1 text-[11px] text-text-subtle transition hover:bg-surface-hover hover:text-text-primary"
                        onClick={() => openEdit(item)}
                      >
                        {t("credentials.edit")}
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-border px-2 py-1 text-[11px] text-text-subtle transition hover:bg-surface-hover hover:text-rose-400"
                        onClick={() => {
                          setDeleteError("");
                          setPendingDelete(item);
                        }}
                      >
                        {t("credentials.delete")}
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <Modal
        open={editor !== null}
        title={editor?.mode === "edit" ? t("credentials.editTitle") : t("credentials.createTitle")}
        onClose={closeEditor}
        backdropClassName="bg-black/75"
        panelClassName="w-full max-w-[min(92vw,480px)] bg-[var(--surface-base-fallback)]"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button type="button" className={SECONDARY_BUTTON_CLASS} disabled={saving} onClick={closeEditor}>
              {tCommon("cancel")}
            </button>
            <button type="button" className={PRIMARY_BUTTON_CLASS} disabled={!canSave} onClick={() => void save()}>
              {saving ? t("credentials.saving") : tCommon("save")}
            </button>
          </div>
        }
      >
        {editor ? (
          <div className="space-y-3">
            <label className="block text-sm text-text-muted">
              {t("credentials.name")}
              <input
                className={`${FIELD_CLASS}${editor.mode === "edit" ? " cursor-not-allowed text-text-muted" : ""}`}
                value={editor.name}
                readOnly={editor.mode === "edit"}
                autoComplete="off"
                spellCheck={false}
                placeholder={t("credentials.namePh")}
                aria-invalid={nameInvalid}
                aria-describedby={nameInvalid ? "credential-name-hint" : undefined}
                onChange={(event) => {
                  const name = event.target.value;
                  setEditor((current) => (current ? { ...current, name, error: "" } : current));
                }}
              />
            </label>
            {nameInvalid ? (
              <p id="credential-name-hint" className="text-[11px] leading-relaxed text-rose-400">
                {t("credentials.nameInvalid")}
              </p>
            ) : null}
            <label className="block text-sm text-text-muted">
              {t("credentials.value")}
              <input
                className={FIELD_CLASS}
                type="password"
                value={editor.value}
                autoComplete="new-password"
                spellCheck={false}
                placeholder={editor.mode === "edit" ? t("credentials.valueKeep") : t("credentials.valuePh")}
                onChange={(event) => {
                  const value = event.target.value;
                  setEditor((current) => (current ? { ...current, value, error: "" } : current));
                }}
              />
            </label>
            <label className="block text-sm text-text-muted">
              {t("credentials.description")}
              <input
                className={FIELD_CLASS}
                value={editor.description}
                autoComplete="off"
                onChange={(event) => {
                  const description = event.target.value;
                  setEditor((current) => (current ? { ...current, description, error: "" } : current));
                }}
              />
            </label>
            {editor.error ? <p className="text-[11px] leading-relaxed text-rose-400">{editor.error}</p> : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={pendingDelete !== null}
        title={t("credentials.deleteTitle")}
        onClose={() => {
          if (deleting) return;
          setPendingDelete(null);
        }}
        backdropClassName="bg-black/75"
        panelClassName="w-full max-w-[min(92vw,440px)] bg-[var(--surface-base-fallback)]"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              className={SECONDARY_BUTTON_CLASS}
              disabled={deleting}
              onClick={() => setPendingDelete(null)}
            >
              {tCommon("cancel")}
            </button>
            <button
              type="button"
              className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-rose-500 disabled:opacity-40"
              disabled={deleting}
              onClick={() => void confirmDelete()}
            >
              {deleting ? t("credentials.deleting") : t("credentials.delete")}
            </button>
          </div>
        }
      >
        <div className="space-y-2 text-sm leading-relaxed text-text-muted">
          <p>{t("credentials.deleteBody", { name: pendingDelete?.name ?? "" })}</p>
          {deleteLabels.length > 0 ? (
            <p>{t("credentials.deleteReferenced", { list: deleteLabels.join("、") })}</p>
          ) : null}
          {deleteError ? <p className="text-[11px] text-rose-400">{deleteError}</p> : null}
        </div>
      </Modal>

      <Toast open={toastOpen} message={toastMessage} onClose={() => setToastOpen(false)} />
    </div>
  );
}
