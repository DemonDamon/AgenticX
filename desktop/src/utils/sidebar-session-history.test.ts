import { describe, expect, it } from "vitest";
import {
  activeAvatarIdForSidebarRow,
  applySidebarSessionHistoryHints,
  bucketSidebarHistoryNodes,
  bucketSidebarHistoryRows,
  includeContinueSearchAncestors,
  flattenSidebarHistoryNodes,
  nestContinueSessionRows,
  findPaneForSidebarSession,
  formatSidebarRelativeTime,
  matchesSidebarAvatarFilter,
  normalizeSidebarSessionRows,
  resolveSidebarAvatarChipName,
  sidebarLoopReviewFetchIds,
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
    const map = new Map([
      ["av1", "飞廉"],
      ["group:g1", "Graph难用例突击队"],
    ]);
    expect(resolveSidebarAvatarChipName({ avatar_id: null }, map)).toBe("Near");
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

  it("only fetches loop-review for visible ids not already fetched", () => {
    const already = new Set(["a", "c"]);
    expect(sidebarLoopReviewFetchIds(["a", "b", "b", "", "c", "d"], already)).toEqual([
      "b",
      "d",
    ]);
    expect(sidebarLoopReviewFetchIds(["a", "c"], already)).toEqual([]);
  });

  it("nests continue-from children under the parent session", () => {
    const now = Date.now() / 1000;
    const rows = normalizeSidebarSessionRows([
      {
        session_id: "parent",
        avatar_id: null,
        session_name: "你好",
        updated_at: now - 120,
      },
      {
        session_id: "child",
        avatar_id: null,
        session_name: "你好 (Fork)",
        updated_at: now,
        parent_session_id: "parent",
      },
      {
        session_id: "other",
        avatar_id: null,
        session_name: "别的",
        updated_at: now - 30,
      },
    ]);
    const tree = nestContinueSessionRows(rows);
    expect(tree.map((node) => node.row.session_id)).toEqual(["other", "parent"]);
    const parent = tree.find((node) => node.row.session_id === "parent");
    expect(parent?.children.map((node) => node.row.session_id)).toEqual(["child"]);
    expect(sidebarSessionLabel(parent!.children[0]!.row, { nestedChild: true })).toBe("你好");
    const nodes = bucketSidebarHistoryNodes(tree, new Set(), now);
    expect(nodes.today.map((node) => node.row.session_id)).toEqual(["other", "parent"]);
    expect(nodes.today.find((node) => node.row.session_id === "parent")?.children).toHaveLength(1);
  });

  it("nests continue-from grandchildren under the child session", () => {
    const now = Date.now() / 1000;
    const rows = normalizeSidebarSessionRows([
      {
        session_id: "parent",
        avatar_id: null,
        session_name: "你好",
        updated_at: now - 180,
      },
      {
        session_id: "child",
        avatar_id: null,
        session_name: "你好",
        updated_at: now - 60,
        parent_session_id: "parent",
      },
      {
        session_id: "grandchild",
        avatar_id: null,
        session_name: "你好",
        updated_at: now,
        parent_session_id: "child",
      },
    ]);
    const tree = nestContinueSessionRows(rows);
    expect(tree.map((node) => node.row.session_id)).toEqual(["parent"]);
    expect(tree[0]?.children.map((node) => node.row.session_id)).toEqual(["child"]);
    expect(tree[0]?.children[0]?.children.map((node) => node.row.session_id)).toEqual([
      "grandchild",
    ]);
    expect(flattenSidebarHistoryNodes(tree).map((row) => row.session_id)).toEqual([
      "parent",
      "child",
      "grandchild",
    ]);
    const nodes = bucketSidebarHistoryNodes(tree, new Set(), now);
    expect(nodes.today.map((node) => node.row.session_id)).toEqual(["parent"]);
  });

  it("keeps a matching child visible by bringing its parent into search results", () => {
    const rows = normalizeSidebarSessionRows([
      {
        session_id: "parent",
        avatar_id: null,
        session_name: "源会话",
        updated_at: 10,
      },
      {
        session_id: "child",
        avatar_id: null,
        session_name: "续写分支",
        updated_at: 20,
        parent_session_id: "parent",
      },
    ]);
    const kept = includeContinueSearchAncestors(rows, new Set(["child"]));
    expect(kept.map((row) => row.session_id).sort()).toEqual(["child", "parent"]);
  });

  it("keeps the full ancestor path when a grandchild matches search", () => {
    const rows = normalizeSidebarSessionRows([
      {
        session_id: "parent",
        avatar_id: null,
        session_name: "源会话",
        updated_at: 10,
      },
      {
        session_id: "child",
        avatar_id: null,
        session_name: "一层",
        updated_at: 20,
        parent_session_id: "parent",
      },
      {
        session_id: "grandchild",
        avatar_id: null,
        session_name: "二层专题",
        updated_at: 30,
        parent_session_id: "child",
      },
    ]);
    const kept = includeContinueSearchAncestors(rows, new Set(["grandchild"]));
    expect(kept.map((row) => row.session_id).sort()).toEqual([
      "child",
      "grandchild",
      "parent",
    ]);
  });
});
