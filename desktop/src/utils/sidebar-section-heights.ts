export type SidebarSectionHeights = {
  avatarsHeight: number | null;
  groupsHeight: number | null;
};

const STORAGE_KEY = "agx-sidebar-section-heights-v1";
const MIN_SECTION_HEIGHT = 36;
const MAX_SECTION_HEIGHT = 720;

function parseHeight(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.min(Math.max(n, MIN_SECTION_HEIGHT), MAX_SECTION_HEIGHT));
}

export function loadSidebarSectionHeights(): SidebarSectionHeights {
  if (typeof window === "undefined") {
    return { avatarsHeight: null, groupsHeight: null };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { avatarsHeight: null, groupsHeight: null };
    const parsed = JSON.parse(raw) as Partial<SidebarSectionHeights>;
    return {
      avatarsHeight: parsed.avatarsHeight != null ? parseHeight(parsed.avatarsHeight) : null,
      groupsHeight: parsed.groupsHeight != null ? parseHeight(parsed.groupsHeight) : null,
    };
  } catch {
    return { avatarsHeight: null, groupsHeight: null };
  }
}

export function saveSidebarSectionHeights(heights: SidebarSectionHeights): void {
  if (typeof window === "undefined") return;
  try {
    const payload: SidebarSectionHeights = {
      avatarsHeight: heights.avatarsHeight != null ? parseHeight(heights.avatarsHeight) : null,
      groupsHeight: heights.groupsHeight != null ? parseHeight(heights.groupsHeight) : null,
    };
    if (payload.avatarsHeight == null && payload.groupsHeight == null) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage failures
  }
}
