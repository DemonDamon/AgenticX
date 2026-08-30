import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Plus, X } from "lucide-react";
import { useAppStore, type Avatar, type GroupChat } from "../../store";
import { usePaneNavigation } from "../../hooks/usePaneNavigation";
import { avatarBgClass, avatarFgClass } from "../../utils/avatar-color";
import { getRememberedSessionForAvatar } from "../../utils/avatar-last-session";
import { sanitizeGroupAvatarIds } from "../../utils/group-editor-utils";
import { isSessionAvatarMatch, pickMostRecentSessionId } from "../../utils/group-pane-open";
import {
  buildSuggestions,
  composeEnterHint,
  composePlaceholder,
  consumeCommaInput,
  formatGroupDisplayName,
  previewTarget,
  resolveEnterCommit,
  resolveTabAdd,
  shouldDismissComposeOnOutsideClick,
  type ComposeChip,
  type ComposeSuggestion,
} from "../../utils/quick-compose";

type Snapshot = { mainView: ReturnType<typeof useAppStore.getState>["mainView"]; activePaneId: string };

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase() || "+";
}

function mapCreatedAvatar(item: {
  id: string;
  name: string;
  role?: string;
  avatar_url?: string;
  pinned?: boolean;
  created_by?: string;
  color?: string;
}): Avatar {
  return {
    id: item.id,
    name: item.name,
    role: item.role ?? "",
    avatarUrl: item.avatar_url ?? "",
    pinned: Boolean(item.pinned),
    createdBy: item.created_by ?? "manual",
    color: typeof item.color === "string" ? item.color : "",
  };
}

function ExpertGlyph({
  name,
  color,
  className,
}: {
  name: string;
  color?: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${avatarBgClass(color)} ${avatarFgClass(color)} ${className ?? "h-5 w-5"}`}
    >
      {initials(name)}
    </span>
  );
}

function GroupGlyph({ members }: { members: Avatar[] }) {
  const shown = members.slice(0, 3);
  return (
    <span className="relative inline-flex h-5 w-7 shrink-0 items-center">
      {shown.map((member, index) => (
        <span
          key={member.id}
          className="absolute top-0"
          style={{ left: index * 7, zIndex: shown.length - index }}
        >
          <ExpertGlyph name={member.name} color={member.color} className="h-5 w-5 ring-1 ring-surface-base" />
        </span>
      ))}
    </span>
  );
}

export function QuickComposeOverlay() {
  const intent = useAppStore((s) => s.quickComposeIntent);
  const closeQuickCompose = useAppStore((s) => s.closeQuickCompose);
  const avatars = useAppStore((s) => s.avatars);
  const groups = useAppStore((s) => s.groups);
  const setAvatars = useAppStore((s) => s.setAvatars);
  const setGroups = useAppStore((s) => s.setGroups);
  const setMainView = useAppStore((s) => s.setMainView);
  const setActivePaneId = useAppStore((s) => s.setActivePaneId);
  const setPaneSessionId = useAppStore((s) => s.setPaneSessionId);
  const upsertComposePreviewPane = useAppStore((s) => s.upsertComposePreviewPane);
  const clearComposePreview = useAppStore((s) => s.clearComposePreview);
  const promoteComposePreview = useAppStore((s) => s.promoteComposePreview);
  const { openMetaOrAvatarPane, openGroupPane } = usePaneNavigation();

  const [chips, setChips] = useState<ComposeChip[]>([]);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(true);
  const [previewEpoch, setPreviewEpoch] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const snapshotRef = useRef<Snapshot | null>(null);
  const allowPreviewRef = useRef(false);
  const previewGenRef = useRef(0);

  const excludeAvatarIds = useMemo(
    () => chips.filter((chip): chip is Extract<ComposeChip, { kind: "avatar" }> => chip.kind === "avatar").map((chip) => chip.id),
    [chips],
  );

  const suggestions = useMemo(
    () =>
      buildSuggestions({
        query,
        avatars: avatars.map((item) => ({ id: item.id, name: item.name })),
        groups: groups.map((item) => ({ id: item.id, name: item.name, avatarIds: item.avatarIds })),
        excludeAvatarIds,
      }),
    [query, avatars, groups, excludeAvatarIds],
  );

  const highlighted = suggestions[highlight] ?? null;
  const enterHint = composeEnterHint(highlighted?.kind, chips.length, query);

  useEffect(() => {
    if (!intent) return;
    const state = useAppStore.getState();
    snapshotRef.current = { mainView: state.mainView, activePaneId: state.activePaneId };
    allowPreviewRef.current = false;
    previewGenRef.current += 1;
    setChips([]);
    setQuery("");
    setHighlight(0);
    setError("");
    setBusy(false);
    setDropdownOpen(true);
    if (state.mainView !== "chat") state.setMainView("chat");
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [intent]);

  useEffect(() => {
    if (highlight >= suggestions.length) {
      setHighlight(Math.max(0, suggestions.length - 1));
    }
  }, [highlight, suggestions.length]);

  const updateDropdownPos = useCallback(() => {
    const el = barRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setDropdownPos({
      top: rect.bottom + 6,
      left: Math.max(12, rect.left),
      width: Math.max(rect.width, 320),
    });
  }, []);

  useEffect(() => {
    if (!intent) return;
    updateDropdownPos();
    window.addEventListener("resize", updateDropdownPos);
    window.addEventListener("scroll", updateDropdownPos, true);
    return () => {
      window.removeEventListener("resize", updateDropdownPos);
      window.removeEventListener("scroll", updateDropdownPos, true);
    };
  }, [intent, chips.length, query, updateDropdownPos]);

  const bindPreviewSession = useCallback(
    async (paneId: string, avatarId: string | null, gen: number) => {
      const listed = await window.agenticxDesktop
        .listSessions(avatarId ?? undefined)
        .catch(() => ({ ok: false, sessions: [] as Array<{
          session_id?: string;
          avatar_id?: string | null;
          updated_at?: number;
          provider?: string;
          model?: string;
        }> }));
      if (previewGenRef.current !== gen) return;
      const rows = listed.ok && Array.isArray(listed.sessions) ? listed.sessions : [];
      const rememberedSid = getRememberedSessionForAvatar(avatarId);
      const rememberedValid =
        !!rememberedSid &&
        rows.some(
          (item) =>
            String(item.session_id ?? "").trim() === rememberedSid &&
            isSessionAvatarMatch(item, avatarId),
        );
      const recentSid = pickMostRecentSessionId(rows, avatarId);
      const preferredSid = rememberedValid ? rememberedSid ?? undefined : recentSid;
      if (!preferredSid || previewGenRef.current !== gen) return;
      const latest = useAppStore.getState().panes.find((item) => item.id === paneId);
      if (!latest) return;
      if (String(latest.sessionId ?? "").trim() === preferredSid) return;
      const row = rows.find((item) => String(item.session_id ?? "").trim() === preferredSid);
      setPaneSessionId(paneId, preferredSid, { provider: row?.provider, model: row?.model });
    },
    [setPaneSessionId],
  );

  useEffect(() => {
    if (!intent || !allowPreviewRef.current) return;
    const target = previewTarget(highlighted);
    const snap = snapshotRef.current;
    if (!target) {
      previewGenRef.current += 1;
      clearComposePreview(snap?.activePaneId);
      return;
    }
    const avatarId = target.type === "group" ? `group:${target.id}` : target.id;
    const { paneId, reusedDurable } = upsertComposePreviewPane(avatarId, target.name);
    if (reusedDurable) return;
    const gen = ++previewGenRef.current;
    const timer = window.setTimeout(() => {
      void bindPreviewSession(paneId, avatarId, gen);
    }, 80);
    return () => window.clearTimeout(timer);
  }, [bindPreviewSession, clearComposePreview, highlighted, intent, previewEpoch, upsertComposePreviewPane]);

  const cancel = useCallback(() => {
    const snap = snapshotRef.current;
    previewGenRef.current += 1;
    clearComposePreview(snap?.activePaneId);
    closeQuickCompose();
    if (!snap) return;
    if (snap.mainView !== "chat") {
      useAppStore.getState().setMainView(snap.mainView);
      return;
    }
    setMainView("chat");
    if (snap.activePaneId) setActivePaneId(snap.activePaneId);
  }, [clearComposePreview, closeQuickCompose, setActivePaneId, setMainView]);

  const applyChips = useCallback((next: ComposeChip[]) => {
    allowPreviewRef.current = false;
    setChips(next);
    setQuery("");
    setHighlight(0);
    setError("");
    setDropdownOpen(true);
  }, []);

  useEffect(() => {
    if (!intent) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target) || dropdownRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest("[data-quick-compose-trigger]")) return;
      if (shouldDismissComposeOnOutsideClick(query, chips.length)) {
        cancel();
        return;
      }
      setDropdownOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [intent, query, chips.length, cancel]);

  const addFromSuggestion = useCallback(
    (suggestion: ComposeSuggestion | null, rawQuery: string) => {
      const result = resolveTabAdd({
        chips,
        suggestion,
        query: rawQuery,
        avatars: avatars.map((item) => ({ id: item.id, name: item.name })),
      });
      if (result.action === "add-chips") applyChips(result.chips);
    },
    [applyChips, avatars, chips],
  );

  const persistCreatedAvatar = useCallback(
    async (name: string): Promise<Avatar> => {
      const existing = useAppStore
        .getState()
        .avatars.find((item) => item.name.trim().toLowerCase() === name.trim().toLowerCase());
      if (existing) return existing;
      const result = await window.agenticxDesktop.createAvatar({
        name: name.trim(),
        created_by: "manual",
      });
      if (!result.ok || !result.avatar) {
        throw new Error(result.error || "创建专家失败");
      }
      const mapped = mapCreatedAvatar(result.avatar);
      setAvatars([...useAppStore.getState().avatars.filter((item) => item.id !== mapped.id), mapped]);
      window.dispatchEvent(
        new CustomEvent("agenticx:avatars:changed", {
          detail: { avatarId: mapped.id, name: mapped.name, openPane: false },
        }),
      );
      return mapped;
    },
    [setAvatars],
  );

  const persistGroup = useCallback(
    async (avatarIds: string[], pendingNames: string[]) => {
      const createdIds: string[] = [];
      for (const name of pendingNames) {
        const created = await persistCreatedAvatar(name);
        createdIds.push(created.id);
      }
      const validIds = useAppStore.getState().avatars.map((item) => item.id);
      const normalized = sanitizeGroupAvatarIds({
        requestedIds: [...avatarIds, ...createdIds],
        validAvatarIds: validIds,
      });
      if (normalized.avatarIds.length === 0) {
        throw new Error("请至少添加 1 位专家后再创建群聊。");
      }
      const name = formatGroupDisplayName(
        normalized.avatarIds.map((id) => useAppStore.getState().avatars.find((item) => item.id === id)?.name ?? id),
      );
      const result = await window.agenticxDesktop.createGroup({
        name,
        avatar_ids: normalized.avatarIds,
        routing: "intelligent",
      });
      if (!result.ok || !result.group) {
        throw new Error(result.error || "创建群聊失败");
      }
      const group: GroupChat = {
        id: result.group.id,
        name: result.group.name,
        avatarIds: result.group.avatar_ids ?? normalized.avatarIds,
        routing: result.group.routing ?? "intelligent",
      };
      setGroups([...useAppStore.getState().groups.filter((item) => item.id !== group.id), group]);
      window.dispatchEvent(new CustomEvent("agenticx:groups:changed"));
      return group;
    },
    [persistCreatedAvatar, setGroups],
  );

  const finish = useCallback(async (suggestion: ComposeSuggestion | null = highlighted) => {
    if (busy) return;
    const commit = resolveEnterCommit({ chips, suggestion, query });
    if (commit.action === "noop") return;
    setBusy(true);
    setError("");
    try {
      if (commit.action === "open-avatar") {
        const durable = useAppStore
          .getState()
          .panes.find((pane) => pane.avatarId === commit.id && !pane.composePreview);
        if (durable) {
          clearComposePreview();
          openMetaOrAvatarPane(commit.id, commit.name);
        } else if (useAppStore.getState().panes.some((pane) => pane.composePreview && pane.avatarId === commit.id)) {
          promoteComposePreview();
        } else {
          clearComposePreview();
          openMetaOrAvatarPane(commit.id, commit.name);
        }
        closeQuickCompose();
        return;
      }
      if (commit.action === "open-group") {
        const groupAvatarId = `group:${commit.id}`;
        const durable = useAppStore
          .getState()
          .panes.find((pane) => pane.avatarId === groupAvatarId && !pane.composePreview);
        if (durable) {
          clearComposePreview();
        } else if (useAppStore.getState().panes.some((pane) => pane.composePreview && pane.avatarId === groupAvatarId)) {
          promoteComposePreview();
        } else {
          clearComposePreview();
        }
        const group = useAppStore.getState().groups.find((item) => item.id === commit.id);
        if (group) openGroupPane(group);
        closeQuickCompose();
        return;
      }
      if (commit.action === "create-avatar") {
        clearComposePreview();
        const created = await persistCreatedAvatar(commit.name);
        openMetaOrAvatarPane(created.id, created.name);
        closeQuickCompose();
        return;
      }
      clearComposePreview();
      const group = await persistGroup(commit.avatarIds, commit.pendingNames);
      openGroupPane(group);
      closeQuickCompose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }, [
    busy,
    chips,
    clearComposePreview,
    closeQuickCompose,
    highlighted,
    openGroupPane,
    openMetaOrAvatarPane,
    persistCreatedAvatar,
    persistGroup,
    promoteComposePreview,
    query,
  ]);

  const onQueryChange = (value: string) => {
    const comma = consumeCommaInput(value);
    if (comma) {
      const tokenSuggestions = buildSuggestions({
        query: comma.token,
        avatars: avatars.map((item) => ({ id: item.id, name: item.name })),
        groups: groups.map((item) => ({ id: item.id, name: item.name, avatarIds: item.avatarIds })),
        excludeAvatarIds,
      });
      addFromSuggestion(tokenSuggestions[0] ?? null, comma.token);
      setQuery(comma.remainder);
      return;
    }
    allowPreviewRef.current = Boolean(value.trim());
    setQuery(value);
    setHighlight(0);
    setError("");
    setDropdownOpen(true);
    if (value.trim()) setPreviewEpoch((n) => n + 1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      allowPreviewRef.current = true;
      setDropdownOpen(true);
      setHighlight((index) => Math.min(suggestions.length - 1, index + 1));
      setPreviewEpoch((n) => n + 1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      allowPreviewRef.current = true;
      setDropdownOpen(true);
      setHighlight((index) => Math.max(0, index - 1));
      setPreviewEpoch((n) => n + 1);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      addFromSuggestion(highlighted, query);
      return;
    }
    if (event.key === "Backspace" && !query && chips.length > 0) {
      event.preventDefault();
      applyChips(chips.slice(0, -1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      void finish();
    }
  };

  if (!intent) return null;

  const dropdown =
    dropdownOpen && dropdownPos && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={dropdownRef}
            className="z-[180] overflow-hidden rounded-xl bg-surface-base shadow-xl"
            style={{
              position: "fixed",
              top: dropdownPos.top,
              left: dropdownPos.left,
              width: dropdownPos.width,
            }}
            onMouseDown={(event) => event.preventDefault()}
          >
            <ul className="max-h-[320px] overflow-y-auto py-1" role="listbox">
              {suggestions.length === 0 ? (
                <li className="px-3 py-2 text-[13px] text-text-faint">输入名称以创建专家</li>
              ) : (
                suggestions.map((row, index) => {
                  const active = index === highlight;
                  return (
                    <li key={`${row.kind}:${row.kind === "create" ? row.name : row.id}`}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={active}
                        className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] ${
                          active ? "bg-surface-hover text-text-strong" : "text-text-strong"
                        }`}
                        onMouseEnter={() => {
                          allowPreviewRef.current = true;
                          setHighlight(index);
                          setPreviewEpoch((n) => n + 1);
                        }}
                        onClick={() => {
                          setHighlight(index);
                          addFromSuggestion(row, query);
                          window.setTimeout(() => inputRef.current?.focus(), 0);
                        }}
                      >
                        {row.kind === "create" ? (
                          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-card-strong text-text-muted">
                            <Plus className="h-3 w-3" strokeWidth={2} />
                          </span>
                        ) : row.kind === "group" ? (
                          <GroupGlyph
                            members={row.memberNames
                              .map((name) => avatars.find((item) => item.name === name))
                              .filter((item): item is Avatar => Boolean(item))}
                          />
                        ) : (
                          <ExpertGlyph
                            name={row.name}
                            color={avatars.find((item) => item.id === row.id)?.color}
                          />
                        )}
                        <span className="min-w-0 truncate">
                          {row.kind === "create" ? `创建「${row.name}」` : row.name}
                        </span>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
            <div className="flex justify-end gap-1.5 border-t border-border px-2.5 py-1.5">
              <kbd className="rounded-md bg-surface-card px-1.5 py-0.5 text-[10px] text-text-faint">Tab 添加</kbd>
              <button
                type="button"
                className="rounded-md bg-surface-card px-1.5 py-0.5 text-[10px] text-text-faint hover:text-text-strong"
                onClick={() => void finish()}
              >
                ↵ {busy ? "创建中…" : enterHint}
              </button>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <div ref={rootRef} className="shrink-0 border-b border-border bg-surface-base px-4 py-2.5">
      <div className="flex items-start gap-2">
        <span className="mt-1 shrink-0 text-[13px] text-text-muted">收件人：</span>
        <div ref={barRef} className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <span
              key={chip.kind === "avatar" ? chip.id : `c:${chip.name}`}
              className="inline-flex items-center gap-1.5 rounded-full bg-surface-card-strong py-0.5 pl-0.5 pr-1.5 text-[12px] text-text-strong"
            >
              {chip.kind === "create" ? (
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-surface-hover text-text-muted">
                  <Plus className="h-3 w-3" strokeWidth={2} />
                </span>
              ) : (
                <ExpertGlyph
                  name={chip.name}
                  color={avatars.find((item) => item.id === chip.id)?.color}
                />
              )}
              <span className="max-w-[140px] truncate">{chip.name}</span>
              <button
                type="button"
                className="rounded-full p-0.5 text-text-faint hover:text-text-strong"
                aria-label={`移除 ${chip.name}`}
                onClick={() => applyChips(chips.filter((item) => item !== chip))}
              >
                <X className="h-3 w-3" strokeWidth={2} />
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            value={query}
            disabled={busy}
            onChange={(event) => {
              if ((event.nativeEvent as { isComposing?: boolean }).isComposing) {
                setQuery(event.target.value);
                return;
              }
              onQueryChange(event.target.value);
            }}
            onFocus={() => setDropdownOpen(true)}
            onKeyDown={onKeyDown}
            placeholder={composePlaceholder(intent, chips.length)}
            className="min-w-[160px] flex-1 bg-transparent py-1 text-[13px] text-text-strong outline-none placeholder:text-text-faint"
            aria-label="搜索或创建专家"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <button
          type="button"
          className="mt-0.5 rounded-md p-1 text-text-faint hover:bg-surface-hover hover:text-text-strong"
          aria-label="取消"
          onClick={cancel}
        >
          <X className="h-4 w-4" strokeWidth={1.8} />
        </button>
      </div>
      {error ? <p className="mt-1.5 pl-[4.5rem] text-[12px] text-rose-400">{error}</p> : null}
      {dropdown}
    </div>
  );
}
