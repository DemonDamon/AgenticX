import { afterEach, describe, expect, it, vi } from "vitest";
import {
  postWorkItemAction,
  studioBaseUrl,
  workItemBlockerHint,
  workItemRequestError,
  workItemStatusLabel,
  type WorkItem,
} from "./work-items";

function item(partial: Partial<WorkItem> & Pick<WorkItem, "id" | "status">): WorkItem {
  return {
    group_id: "g1",
    title: partial.title || partial.id,
    owner_kind: "avatar",
    owner_id: "a1",
    definition_of_done: "",
    artifact_paths: [],
    blocked_by: [],
    version: 1,
    ...partial,
  };
}

describe("workItemBlockerHint", () => {
  it("shows 前置未验收 when a blocker is not accepted", () => {
    const blocker = item({ id: "wi_1", status: "in_progress", title: "统一模型调用协议" });
    const waiting = item({
      id: "wi_2",
      status: "open",
      title: "路由可视化",
      blocked_by: ["wi_1"],
    });
    expect(workItemBlockerHint(waiting, [blocker, waiting])).toBe("前置未验收");
  });

  it("hides the hint after the blocker is accepted", () => {
    const blocker = item({ id: "wi_1", status: "accepted" });
    const waiting = item({ id: "wi_2", status: "open", blocked_by: ["wi_1"] });
    expect(workItemBlockerHint(waiting, [blocker, waiting])).toBe("");
  });
});

describe("workItemStatusLabel", () => {
  it("maps submitted to 待验收", () => {
    expect(workItemStatusLabel("submitted")).toBe("待验收");
  });
});

describe("studioBaseUrl", () => {
  it("prefers store apiBase over the unused 19080 fallback", () => {
    expect(studioBaseUrl("http://127.0.0.1:52079/")).toBe("http://127.0.0.1:52079");
  });
});

describe("workItemRequestError", () => {
  it("maps Failed to fetch to a readable label", () => {
    expect(workItemRequestError(new Error("Failed to fetch"))).toBe("事项接口连不上");
  });
});

describe("postWorkItemAction", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("marks 409 as conflict", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 409 })),
    );
    await expect(
      postWorkItemAction("g1", "wi_abc", "tok", "accept", 1),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});
