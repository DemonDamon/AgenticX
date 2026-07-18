import { describe, expect, it } from "vitest";
import {
  bucketSidebarHistoryRows,
  matchesSidebarAvatarFilter,
  normalizeSidebarSessionRows,
  resolveSidebarAvatarChipName,
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

  it("buckets pinned / today / earlier and skips special ids", () => {
    const now = Date.now() / 1000;
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
        updated_at: now - 10,
        pinned: true,
      },
      {
        session_id: "t1",
        avatar_id: null,
        session_name: "今日",
        updated_at: now - 60,
      },
      {
        session_id: "o1",
        avatar_id: "av1",
        session_name: "更早",
        updated_at: now - 86400 * 3,
      },
    ]);
    const buckets = bucketSidebarHistoryRows(rows, new Set(["im"]), now);
    expect(buckets.pinned.map((r) => r.session_id)).toEqual(["p1"]);
    expect(buckets.today.map((r) => r.session_id)).toEqual(["t1"]);
    expect(buckets.earlier.map((r) => r.session_id)).toEqual(["o1"]);
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
    const map = new Map([["av1", "飞廉"]]);
    expect(resolveSidebarAvatarChipName({ avatar_id: null }, map)).toBe("Near");
    expect(resolveSidebarAvatarChipName({ avatar_id: "av1" }, map)).toBe("飞廉");
    expect(
      resolveSidebarAvatarChipName({ avatar_id: "group:g1", avatar_name: "项目组" }, map)
    ).toBe("项目组");
  });
});
