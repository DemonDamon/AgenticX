import { describe, expect, it } from "vitest";

import {
  fromLiveSubAgent,
  fromRunRecord,
  mergeBadgeVMs,
} from "../components/subagent/badge-vm";
import { shouldHydratePersistedRun } from "./subagent-hydrate";

describe("subagent terminal status reconciliation", () => {
  it("lets a persisted terminal record override stale live running state", () => {
    const persisted = fromRunRecord({
      run_id: "sa-finished",
      name: "writer",
      role: "coder",
      status: "completed",
      result_summary: "done",
    });
    const live = fromLiveSubAgent({
      id: "sa-finished",
      name: "writer",
      role: "coder",
      status: "running",
      task: "write",
      events: [],
    });

    expect(mergeBadgeVMs([persisted], [live])[0]).toMatchObject({
      status: "completed",
      progress: 1,
      resultSummary: "done",
      source: "persisted",
    });
  });

  it("hydrates terminal disk state over stale live state but never regresses a terminal state", () => {
    expect(shouldHydratePersistedRun("running", "completed")).toBe(true);
    expect(shouldHydratePersistedRun("running", "cancelled")).toBe(true);
    expect(shouldHydratePersistedRun("running", "running")).toBe(false);
    expect(shouldHydratePersistedRun("completed", "running")).toBe(false);
  });
});
