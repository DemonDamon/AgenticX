import { describe, expect, it } from "vitest";
import {
  SAMPLE_BOARD,
  SAMPLE_MEMBER_ROWS,
  applyDrill,
  bindWidget,
} from "../data-board-fixture";

describe("data-board-fixture", () => {
  it("has sample board widgets", () => {
    expect(SAMPLE_BOARD.id).toBe("sample_member_board");
    expect(SAMPLE_BOARD.widgets.length).toBeGreaterThanOrEqual(1);
  });

  it("binds region counts", () => {
    const w = SAMPLE_BOARD.widgets.find((x) => x.id === "members_by_region")!;
    const points = bindWidget(w, SAMPLE_MEMBER_ROWS);
    const map = Object.fromEntries(points.map((p) => [p.name, p.value]));
    expect(map).toEqual({ east: 2, north: 1, west: 2 });
  });

  it("drills by brand then binds tier", () => {
    const drilled = applyDrill(SAMPLE_MEMBER_ROWS, SAMPLE_BOARD.drillLevels, ["B"]);
    const w = SAMPLE_BOARD.widgets.find((x) => x.id === "members_by_tier")!;
    const points = bindWidget(w, drilled);
    const map = Object.fromEntries(points.map((p) => [p.name, p.value]));
    expect(map).toEqual({ bronze: 1, gold: 1 });
  });
});
