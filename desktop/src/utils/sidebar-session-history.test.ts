import { describe, expect, it } from "vitest";
import {
  activeAvatarIdForSidebarRow,
  applySidebarSessionHistoryHints,
  bucketSidebarHistoryRows,
  findPaneForSidebarSession,
  formatSidebarRelativeTime,
  matchesSidebarAvatarFilter,
  normalizeSidebarSessionRows,
  resolveSidebarAvatarChipName,
  sidebarSessionHasRenderableMessages,
  sidebarSessionLabel,
} from "./sidebar-session-history";

describe("sidebar-session-history utils", () => {
  it("normalizes and drops automation + archived", () => {
    const rows = normalizeSidebarSessionRows([
      {
        session_id: "a",
        avatar_id: null,
        session_name: "你好世界",
        updated_at: 100,
        pinned: false,
      },
      {
        session_id: "b",
        avatar_id: "automation:t1",
        session_name: "auto",
        updated_at: 200,
      },
      {
        session_id: "c",
        avatar_id: "av1",
        session_name: "旧",
        updated_at: 50,
        archived: true,
      },
    ]);
    expect(rows.map((r) => r.session_id)).toEqual(["a"]);
    expect(sidebarSessionLabel(rows[0]!)).toBe("你好世界");
  });

  it("buckets pinned and local-calendar date ranges without duplicates", () => {
    const nowDate = new Date(2026, 7, 18, 12, 0, 0);
    const now = nowDate.getTime() / 1000;
    const atLocalTimeDaysAgo = (daysAgo: number, hour = 12) => {
      const date = new Date(nowDate);
      date.setDate(date.getDate() - daysAgo);
      date.setHours(hour, 0, 0, 0);
      return date.getTime() / 1000;
    };
    const rows = normalizeSidebarSessionRows([
      {
        session_id: "im",
        avatar_id: null,
        session_name: "绑定会话",
        updated_at: now,
        pinned: true,
      },
      {
        session_id: "p1",
        avatar_id: "av1",
        session_name: "置顶一",
        updated_at: atLocalTimeDaysAgo(3),
        pinned: true,
      },
      {
        session_id: "t1",
        avatar_id: null,
        session_name: "今日",
        updated_at: atLocalTimeDaysAgo(0, 1),
      },
      {
        session_id: "y1",
        avatar_id: "av1",
        session_name: "昨日",
        updated_at: atLocalTimeDaysAgo(1, 23),
      },
      {
        session_id: "r1",
        avatar_id: "av1",
        session_name: "近期",
        updated_at: atLocalTimeDaysAgo(7, 1),
      },
      {
        session_id: "o1",
        avatar_id: "av1",
        session_name: "更早",
        updated_at: atLocalTimeDaysAgo(8, 23),
      },
    ]);
    const buckets = bucketSidebarHistoryRows(rows, new Set(["im"]), now);
    expect(buckets.pinned.map((r) => r.session_id)).toEqual(["p1"]);
    expect(buckets.today.map((r) => r.session_id)).toEqual(["t1"]);
    expect(buckets.yesterday.map((r) => r.session_id)).toEqual(["y1"]);
    expect(buckets.recent.map((r) => r.session_id)).toEqual(["r1"]);
    expect(buckets.earlier.map((r) => r.session_id)).toEqual(["o1"]);
    expect(
      [
        ...buckets.today,
        ...buckets.yesterday,
        ...buckets.recent,
        ...buckets.earlier,
      ].map((r) => r.session_id)
    ).not.toContain("p1");
  });

  it("filters by avatar including meta", () => {
    const rowMeta = { avatar_id: null as string | null };
    const rowAv = { avatar_id: "av1" };
    expect(matchesSidebarAvatarFilter(rowMeta, "all")).toBe(true);
    expect(matchesSidebarAvatarFilter(rowAv, "all")).toBe(true);
    expect(matchesSidebarAvatarFilter(rowMeta, "__meta__")).toBe(true);
    expect(matchesSidebarAvatarFilter(rowAv, "__meta__")).toBe(false);
    expect(matchesSidebarAvatarFilter(rowAv, "av1")).toBe(true);
  });

  it("resolves chip names", () => {
    const map = new Map([
      ["av1", "飞廉"],
      ["group:g1", "Graph难用例突击队"],
    ]);
    expect(resolveSidebarAvatarChipName({ avatar_id: null }, map)).toBe("和创智派");
    expect(resolveSidebarAvatarChipName({ avatar_id: "av1" }, map)).toBe("飞廉");
    expect(
      resolveSidebarAvatarChipName({ avatar_id: "group:g1", avatar_name: "项目组" }, map)
    ).toBe("Graph难用例突击队");
    expect(
      resolveSidebarAvatarChipName({ avatar_id: "group:g1", avatar_name: null }, map)
    ).toBe("Graph难用例突击队");
    expect(
      resolveSidebarAvatarChipName({ avatar_id: "group:unknown", avatar_name: null }, map)
    ).toBe("群聊");
  });

  it("formats relative activity time", () => {
    const now = Date.parse("2026-07-19T12:00:00.000Z");
    expect(formatSidebarRelativeTime(now / 1000 - 30, now)).toBe("刚刚");
    expect(formatSidebarRelativeTime(now / 1000 - 3600 * 5, now)).toBe("5 小时前");
    expect(formatSidebarRelativeTime(now / 1000 - 86400 * 3, now)).toBe("3 天前");
  });

  it("preserves execution_state from list API", () => {
    const rows = normalizeSidebarSessionRows([
      {
        session_id: "r1",
        avatar_id: null,
        session_name: "跑着",
        updated_at: 100,
        execution_state: "running",
      },
      {
        session_id: "i1",
        avatar_id: null,
        session_name: "中断",
        updated_at: 90,
        execution_state: "interrupted",
      },
    ]);
    expect(rows.find((r) => r.session_id === "r1")?.execution_state).toBe("running");
    expect(rows.find((r) => r.session_id === "i1")?.execution_state).toBe("interrupted");
  });

  it("applies optimistic running hint until backend catches up", () => {
    const rows = normalizeSidebarSessionRows([
      {
        session_id: "s1",
        avatar_id: null,
        session_name: "会话",
        updated_at: 100,
        execution_state: "idle",
      },
    ]);
    const hinted = applySidebarSessionHistoryHints(rows, {
      s1: { activityAt: 200, running: true },
    });
    expect(hinted[0]?.execution_state).toBe("running");
    expect(hinted[0]?.updated_at).toBe(200);

    const caughtUp = applySidebarSessionHistoryHints(
      normalizeSidebarSessionRows([
        {
          session_id: "s1",
          avatar_id: null,
          session_name: "会话",
          updated_at: 200,
          execution_state: "idle",
        },
      ]),
      { s1: { activityAt: 200, running: true } }
    );
    expect(caughtUp[0]?.execution_state).toBe("idle");
  });

  it("finds sidebar open target by session before avatar", () => {
    const panes = [
      { id: "zombie", sessionId: "old", avatarId: "group:g1" },
      { id: "live", sessionId: "sid-1", avatarId: "group:g1" },
    ];
    const found = findPaneForSidebarSession(panes, {
      session_id: "sid-1",
      avatar_id: "group:g1",
    });
    expect(found?.id).toBe("live");
  });

  it("treats untagged messages as non-renderable for early-open skip", () => {
    expect(
      sidebarSessionHasRenderableMessages(
        [{ ownerSessionId: undefined }, { ownerSessionId: "other" }],
        "sid-1"
      )
    ).toBe(false);
    expect(
      sidebarSessionHasRenderableMessages([{ ownerSessionId: "sid-1" }], "sid-1")
    ).toBe(true);
  });

  it("clears activeAvatarId for group/automation rows", () => {
    expect(activeAvatarIdForSidebarRow("group:g1")).toBeNull();
    expect(activeAvatarIdForSidebarRow("automation:t1")).toBeNull();
    expect(activeAvatarIdForSidebarRow("av1")).toBe("av1");
    expect(activeAvatarIdForSidebarRow(null)).toBeNull();
  });
});
