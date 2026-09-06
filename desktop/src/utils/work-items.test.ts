import { afterEach, describe, expect, it, vi } from "vitest";
import { postWorkItemAction, workItemStatusLabel } from "./work-items";

describe("workItemStatusLabel", () => {
  it("maps submitted to 待验收", () => {
    expect(workItemStatusLabel("submitted")).toBe("待验收");
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
