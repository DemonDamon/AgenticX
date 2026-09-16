export type QuickComposeIntent = "expert" | "group";

export type ComposeChip =
  | { kind: "avatar"; id: string; name: string }
  | { kind: "create"; name: string };

export type ComposeSuggestion =
  | { kind: "create"; name: string }
  | { kind: "avatar"; id: string; name: string }
  | { kind: "group"; id: string; name: string; memberNames: string[] };

export type EnterCommit =
  | { action: "noop" }
  | { action: "open-avatar"; id: string; name: string }
  | { action: "open-group"; id: string; name: string }
  | { action: "create-avatar"; name: string }
  | { action: "create-group"; avatarIds: string[]; pendingNames: string[] };

export type TabAddResult =
  | { action: "noop" }
  | { action: "add-chips"; chips: ComposeChip[] };

export type PreviewTarget =
  | { type: "avatar"; id: string; name: string }
  | { type: "group"; id: string; name: string };

const DEFAULT_SUGGESTION_LIMIT = 12;

export function normalizeComposeQuery(raw: string): string {
  return String(raw ?? "").trim();
}

/** Empty compose: click-away should close the whole overlay, not leave the list up. */
export function shouldDismissComposeOnOutsideClick(query: string, chipCount: number): boolean {
  return !normalizeComposeQuery(query) && chipCount <= 0;
}

export function chipKey(chip: ComposeChip): string {
  if (chip.kind === "avatar") return `a:${chip.id}`;
  return `c:${normalizeComposeQuery(chip.name).toLowerCase()}`;
}

export function addComposeChip(chips: ComposeChip[], next: ComposeChip): ComposeChip[] {
  const key = chipKey(next);
  if (!key || (next.kind === "create" && !normalizeComposeQuery(next.name))) return chips;
  if (chips.some((item) => chipKey(item) === key)) return chips;
  if (next.kind === "create") {
    const name = normalizeComposeQuery(next.name);
    if (chips.some((item) => item.kind === "create" && item.name.toLowerCase() === name.toLowerCase())) {
      return chips;
    }
  }
  return [...chips, next];
}

/** Split a trailing English/Chinese comma into a token to add. */
export function consumeCommaInput(raw: string): { token: string; remainder: string } | null {
  const value = String(raw ?? "");
  const match = value.match(/^(.*?)([,，])([\s\S]*)$/u);
  if (!match) return null;
  const token = normalizeComposeQuery(match[1] ?? "");
  if (!token) return null;
  return { token, remainder: match[3] ?? "" };
}

export function hasExactAvatarName(
  avatars: Array<{ name: string }>,
  query: string,
): boolean {
  const needle = normalizeComposeQuery(query).toLowerCase();
  if (!needle) return false;
  return avatars.some((item) => item.name.trim().toLowerCase() === needle);
}

export function findAvatarByName(
  avatars: Array<{ id: string; name: string }>,
  query: string,
): { id: string; name: string } | undefined {
  const needle = normalizeComposeQuery(query).toLowerCase();
  if (!needle) return undefined;
  return avatars.find((item) => item.name.trim().toLowerCase() === needle);
}

export function composePlaceholder(intent: QuickComposeIntent, chipCount: number): string {
  if (chipCount > 0) return "添加或创建另一个专家";
  return intent === "group" ? "搜索或添加专家" : "搜索或创建专家";
}

export function composeEnterHint(kind: ComposeSuggestion["kind"] | undefined, chipCount: number, query: string): "打开" | "创建" {
  if (!normalizeComposeQuery(query) && chipCount >= 2) return "创建";
  if (kind === "create") return "创建";
  return "打开";
}

/** "架构师·阿析" → "阿析"; names without · stay as-is. */
export function shortExpertDisplayName(name: string): string {
  const cleaned = normalizeComposeQuery(name);
  if (!cleaned.includes("·")) return cleaned;
  const parts = cleaned.split("·").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 1] ?? cleaned;
  return cleaned;
}

function joinChineseNameList(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]}和${names[1]}`;
  return `${names.slice(0, -1).join("、")}和${names[names.length - 1]}`;
}

/** "阿析和程基岩" — Chinese list used as the default group title. */
export function formatGroupDisplayName(names: string[]): string {
  return joinChineseNameList(names.map(shortExpertDisplayName).filter(Boolean));
}

/** Same join without stripping 角色·, used to recognize already-persisted auto titles. */
export function formatGroupDisplayNameFromFullNames(names: string[]): string {
  return joinChineseNameList(names.map((name) => normalizeComposeQuery(name)).filter(Boolean));
}

/** Prefer the stored custom name; rewrite leftover auto titles that mashed 角色·名字. */
export function resolveGroupTitle(storedName: string, memberFullNames: string[]): string {
  const stored = storedName.trim();
  const shortTitle = formatGroupDisplayName(memberFullNames);
  if (!stored) return shortTitle;
  if (stored === formatGroupDisplayNameFromFullNames(memberFullNames)) return shortTitle;
  return stored;
}

export function previewTarget(suggestion: ComposeSuggestion | null): PreviewTarget | null {
  if (!suggestion) return null;
  if (suggestion.kind === "avatar") {
    return { type: "avatar", id: suggestion.id, name: suggestion.name };
  }
  if (suggestion.kind === "group") {
    return { type: "group", id: suggestion.id, name: suggestion.name };
  }
  return null;
}

function nameIncludes(haystack: string, needle: string): boolean {
  return haystack.trim().toLowerCase().includes(needle);
}

export function buildSuggestions(input: {
  query: string;
  avatars: Array<{ id: string; name: string }>;
  groups: Array<{ id: string; name: string; avatarIds: string[] }>;
  excludeAvatarIds?: Iterable<string>;
  limit?: number;
}): ComposeSuggestion[] {
  const query = normalizeComposeQuery(input.query);
  const needle = query.toLowerCase();
  const exclude = new Set(
    Array.from(input.excludeAvatarIds ?? [], (id) => String(id ?? "").trim()).filter(Boolean),
  );
  const limit = input.limit ?? DEFAULT_SUGGESTION_LIMIT;
  const avatarById = new Map(input.avatars.map((item) => [item.id, item]));

  const visibleAvatars = input.avatars.filter((item) => !exclude.has(item.id));
  const avatarRows: ComposeSuggestion[] = visibleAvatars
    .filter((item) => !needle || nameIncludes(item.name, needle))
    .sort((a, b) => {
      const aExact = a.name.trim().toLowerCase() === needle ? 0 : 1;
      const bExact = b.name.trim().toLowerCase() === needle ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      return a.name.localeCompare(b.name, "zh");
    })
    .map((item) => ({ kind: "avatar" as const, id: item.id, name: item.name }));

  const groupRows: ComposeSuggestion[] = input.groups
    .map((group) => {
      const memberNames = group.avatarIds
        .map((id) => avatarById.get(id)?.name ?? "")
        .filter(Boolean);
      return {
        kind: "group" as const,
        id: group.id,
        name: group.name,
        memberNames,
      };
    })
    .filter((group) => {
      if (!needle) return true;
      if (nameIncludes(group.name, needle)) return true;
      return group.memberNames.some((name) => nameIncludes(name, needle));
    });

  const rows: ComposeSuggestion[] = [];
  if (query && !hasExactAvatarName(input.avatars, query)) {
    rows.push({ kind: "create", name: query });
  }
  rows.push(...avatarRows, ...groupRows);
  return rows.slice(0, limit);
}

export function resolveTabAdd(input: {
  chips: ComposeChip[];
  suggestion: ComposeSuggestion | null;
  query: string;
  avatars?: Array<{ id: string; name: string }>;
}): TabAddResult {
  const query = normalizeComposeQuery(input.query);
  const suggestion = input.suggestion;
  if (suggestion?.kind === "avatar") {
    return { action: "add-chips", chips: addComposeChip(input.chips, suggestion) };
  }
  if (suggestion?.kind === "create") {
    return {
      action: "add-chips",
      chips: addComposeChip(input.chips, { kind: "create", name: suggestion.name }),
    };
  }
  if (suggestion?.kind === "group") {
    const avatars = input.avatars ?? [];
    let next = input.chips;
    for (const name of suggestion.memberNames) {
      const found = avatars.find((item) => item.name === name) ?? findAvatarByName(avatars, name);
      if (found) next = addComposeChip(next, { kind: "avatar", id: found.id, name: found.name });
    }
    return next === input.chips ? { action: "noop" } : { action: "add-chips", chips: next };
  }
  if (query) {
    const existing = findAvatarByName(input.avatars ?? [], query);
    if (existing) {
      return { action: "add-chips", chips: addComposeChip(input.chips, { kind: "avatar", ...existing }) };
    }
    return {
      action: "add-chips",
      chips: addComposeChip(input.chips, { kind: "create", name: query }),
    };
  }
  return { action: "noop" };
}

function commitFromChips(chips: ComposeChip[]): EnterCommit {
  if (chips.length === 0) return { action: "noop" };
  if (chips.length === 1) {
    const only = chips[0];
    if (only.kind === "avatar") return { action: "open-avatar", id: only.id, name: only.name };
    return { action: "create-avatar", name: only.name };
  }
  return {
    action: "create-group",
    avatarIds: chips.filter((item): item is Extract<ComposeChip, { kind: "avatar" }> => item.kind === "avatar").map((item) => item.id),
    pendingNames: chips
      .filter((item): item is Extract<ComposeChip, { kind: "create" }> => item.kind === "create")
      .map((item) => item.name),
  };
}

function mergeSuggestion(chips: ComposeChip[], suggestion: ComposeSuggestion | null, query: string): ComposeChip[] {
  if (suggestion?.kind === "avatar") {
    return addComposeChip(chips, { kind: "avatar", id: suggestion.id, name: suggestion.name });
  }
  if (suggestion?.kind === "create") {
    return addComposeChip(chips, { kind: "create", name: suggestion.name });
  }
  const token = normalizeComposeQuery(query);
  if (token) return addComposeChip(chips, { kind: "create", name: token });
  return chips;
}

/**
 * Enter finishes the compose pass:
 * - highlighted existing group → open that group
 * - otherwise merge the highlight into chips, then open (1) or create a group (2+)
 */
export function resolveEnterCommit(input: {
  chips: ComposeChip[];
  suggestion: ComposeSuggestion | null;
  query: string;
}): EnterCommit {
  const query = normalizeComposeQuery(input.query);
  if (!query) return commitFromChips(input.chips);
  if (input.suggestion?.kind === "group") {
    return { action: "open-group", id: input.suggestion.id, name: input.suggestion.name };
  }
  return commitFromChips(mergeSuggestion(input.chips, input.suggestion, query));
}
