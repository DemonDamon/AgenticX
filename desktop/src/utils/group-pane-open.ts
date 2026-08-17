/** Session row shape used when opening a group pane (subset of Studio list). */
export type GroupOpenSessionRow = {
  session_id?: string;
  avatar_id?: string | null;
  updated_at?: number;
  created_at?: number;
  archived?: boolean;
};

export function isSessionAvatarMatch(
  item: GroupOpenSessionRow,
  avatarId?: string | null
): boolean {
  const targetAvatarId = (avatarId ?? "").trim();
  const itemAvatarId = String(item.avatar_id ?? "").trim();
  if (!targetAvatarId) return itemAvatarId.length === 0;
  return itemAvatarId === targetAvatarId;
}

export function pickMostRecentSessionId(
  sessions: GroupOpenSessionRow[],
  avatarId?: string | null
): string | undefined {
  const sorted = [...sessions]
    .filter((item) => {
      const sid = String(item.session_id ?? "").trim();
      if (!sid) return false;
      if (item.archived === true) return false;
      return isSessionAvatarMatch(item, avatarId);
    })
    .sort((a, b) => {
      const ua = Number.isFinite(a.updated_at) ? (a.updated_at as number) : 0;
      const ub = Number.isFinite(b.updated_at) ? (b.updated_at as number) : 0;
      if (ub !== ua) return ub - ua;
      const ca = Number.isFinite(a.created_at ?? NaN) ? (a.created_at as number) : 0;
      const cb = Number.isFinite(b.created_at ?? NaN) ? (b.created_at as number) : 0;
      return cb - ca;
    });
  const sid = sorted[0]?.session_id;
  return sid ? String(sid).trim() : undefined;
}

/** Bind immediately so the group pane can leave "正在初始化会话…". */
export function pickOptimisticGroupSessionId(
  rememberedSid?: string | null
): string | undefined {
  const sid = String(rememberedSid ?? "").trim();
  return sid || undefined;
}

export function pickConfirmedGroupSessionId(args: {
  rememberedSid?: string | null;
  listed: GroupOpenSessionRow[];
  groupAvatarId: string;
}): string | undefined {
  const remembered = String(args.rememberedSid ?? "").trim();
  const rememberedValid =
    !!remembered &&
    args.listed.some(
      (item) =>
        String(item.session_id ?? "").trim() === remembered &&
        isSessionAvatarMatch(item, args.groupAvatarId)
    );
  if (rememberedValid) return remembered;
  return pickMostRecentSessionId(args.listed, args.groupAvatarId);
}

export function existingGroupPaneNeedsBind(sessionId?: string | null): boolean {
  return !String(sessionId ?? "").trim();
}

/** Optimistic sid is already on the pane — do not contend with message bootstrap. */
export function shouldSkipGroupSessionListOnOpen(args: {
  optimisticSid?: string | null;
  currentSid?: string | null;
}): boolean {
  const optimistic = String(args.optimisticSid ?? "").trim();
  const current = String(args.currentSid ?? "").trim();
  return Boolean(optimistic) && optimistic === current;
}

/** Create only when list found nothing and the pane still has no session id. */
export function shouldCreateGroupSession(args: {
  confirmedSid?: string;
  currentSid?: string | null;
}): boolean {
  if (String(args.confirmedSid ?? "").trim()) return false;
  return !String(args.currentSid ?? "").trim();
}
