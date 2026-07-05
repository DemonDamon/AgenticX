import { describe, expect, it } from "vitest";

function mergeTimelineItems(
  persisted: { seq: number; type: string; title: string; ts: number }[],
  live: { seq: number; type: string; title: string; ts: number }[],
): { seq: number }[] {
  const byTitleTs = new Set(persisted.map((p) => `${p.type}|${p.title}|${Math.floor(p.ts)}`));
  const extraLive = live.filter((l) => !byTitleTs.has(`${l.type}|${l.title}|${Math.floor(l.ts)}`));
  return [...persisted, ...extraLive].sort((a, b) => a.seq - b.seq);
}

describe("run drawer timeline merge", () => {
  it("dedupes live events that match persisted title/type/ts bucket", () => {
    const persisted = [{ seq: 1, type: "tool", title: "搜索网页", ts: 1000.2 }];
    const live = [{ seq: 99, type: "tool", title: "搜索网页", ts: 1000.8 }];
    const merged = mergeTimelineItems(persisted, live);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.seq).toBe(1);
  });

  it("appends unmatched live events after persisted rows", () => {
    const persisted = [{ seq: 1, type: "note", title: "开始", ts: 1 }];
    const live = [{ seq: 99, type: "note", title: "进行中", ts: 2 }];
    const merged = mergeTimelineItems(persisted, live);
    expect(merged).toHaveLength(2);
    expect(merged[1]?.seq).toBe(99);
  });
});
