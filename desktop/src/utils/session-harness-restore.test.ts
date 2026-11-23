import { describe, expect, it, vi } from "vitest";

import {
  planStickyHarnessRestore,
  restorePaneHarnessFromSession,
} from "./preferred-harness";

describe("planStickyHarnessRestore", () => {
  it("adopts the latest message harness when the session field is missing, ignoring Settings preferred", () => {
    const settingsPreferred = null;
    const plan = planStickyHarnessRestore({
      pinned: false,
      paneHarnessId: undefined,
      serverHarnessId: null,
      recoveredHarnessId: "codebuddy",
    });
    expect(plan.harnessId).toBe("codebuddy");
    expect(plan.rebindHarnessId).toBe("codebuddy");
    expect(plan.harnessId).not.toBe(settingsPreferred);
  });

  it("does not invent the Settings preferred harness when nothing is sticky", () => {
    const settingsPreferred = "claude-code";
    const plan = planStickyHarnessRestore({
      pinned: false,
      paneHarnessId: undefined,
      serverHarnessId: null,
      recoveredHarnessId: null,
    });
    expect(plan.harnessId).toBeNull();
    expect(plan.rebindHarnessId).toBeUndefined();
    expect(plan.harnessId).not.toBe(settingsPreferred);
  });

  it("keeps an explicit builtin pin instead of backfilling an older external stamp", () => {
    const plan = planStickyHarnessRestore({
      pinned: true,
      paneHarnessId: null,
      serverHarnessId: null,
      recoveredHarnessId: "codebuddy",
    });
    expect(plan.harnessId).toBeNull();
    expect(plan.rebindHarnessId).toBeUndefined();
  });

  it("rebinds a pinned external pane when the session field is still empty", () => {
    const plan = planStickyHarnessRestore({
      pinned: true,
      paneHarnessId: "codebuddy",
      serverHarnessId: null,
      recoveredHarnessId: null,
    });
    expect(plan.harnessId).toBe("codebuddy");
    expect(plan.rebindHarnessId).toBe("codebuddy");
  });

  it("prefers a persisted external session harness over a backfill id", () => {
    const plan = planStickyHarnessRestore({
      pinned: false,
      paneHarnessId: undefined,
      serverHarnessId: "claude-code",
      recoveredHarnessId: "codebuddy",
    });
    expect(plan.harnessId).toBe("claude-code");
    expect(plan.rebindHarnessId).toBeUndefined();
  });
});

describe("restorePaneHarnessFromSession", () => {
  it("loads the composer harness from the sticky id and preserves the session model", async () => {
    const setPaneHarness = vi.fn();
    const rebindSessionHarness = vi.fn(async () => {});
    const pane = {
      harnessId: undefined as string | null | undefined,
      harnessFollowsPreference: undefined as boolean | undefined,
    };
    await restorePaneHarnessFromSession("pane-1", "822a1eba", {
      getPane: () => pane,
      readBinding: async () => ({ harnessId: null, recoveredHarnessId: "codebuddy" }),
      setPaneHarness,
      rebindSessionHarness,
    });
    expect(setPaneHarness).toHaveBeenCalledWith("pane-1", "codebuddy", false, {
      preserveModel: true,
    });
    expect(rebindSessionHarness).toHaveBeenCalledWith("codebuddy");
  });

  it("does not overwrite a harness the user picked while the read was in flight", async () => {
    const setPaneHarness = vi.fn();
    const rebindSessionHarness = vi.fn(async () => {});
    const pane = {
      harnessId: undefined as string | null | undefined,
      harnessFollowsPreference: undefined as boolean | undefined,
    };
    await restorePaneHarnessFromSession("pane-1", "822a1eba", {
      getPane: () => pane,
      readBinding: async () => {
        pane.harnessId = null;
        pane.harnessFollowsPreference = false;
        return { harnessId: null, recoveredHarnessId: "codebuddy" };
      },
      setPaneHarness,
      rebindSessionHarness,
    });
    expect(setPaneHarness).not.toHaveBeenCalled();
    expect(rebindSessionHarness).not.toHaveBeenCalled();
  });
});
