import { describe, expect, it } from "vitest";
import {
  SESSION_TASK_ARTIFACTS_DIRNAME,
  sessionTaskArtifactsDir,
  shouldPruneAutoArtifactRoot,
} from "./ensure-artifact-taskspaces";

describe("sessionTaskArtifactsDir", () => {
  it("points at session-scoped staging folder", () => {
    expect(sessionTaskArtifactsDir("abc-123")).toBe(
      `~/.agenticx/sessions/abc-123/${SESSION_TASK_ARTIFACTS_DIRNAME}`,
    );
  });
});

describe("shouldPruneAutoArtifactRoot", () => {
  const staging = "/Users/damon/.agenticx/sessions/s1/task_artifacts";
  const opts = {
    sessionId: "s1",
    stagingDir: staging,
    homeDir: "/Users/damon",
  };

  it("keeps the staging root", () => {
    expect(shouldPruneAutoArtifactRoot(staging, opts)).toBe(false);
  });

  it("prunes /tmp and home from naive parent sync", () => {
    expect(shouldPruneAutoArtifactRoot("/tmp", opts)).toBe(true);
    expect(shouldPruneAutoArtifactRoot("/private/tmp", opts)).toBe(true);
    expect(shouldPruneAutoArtifactRoot("/Users/damon", opts)).toBe(true);
  });

  it("prunes this session's raw subagent_results root", () => {
    expect(
      shouldPruneAutoArtifactRoot(
        "/Users/damon/.agenticx/sessions/s1/subagent_results",
        opts,
      ),
    ).toBe(true);
  });

  it("does not prune unrelated project folders", () => {
    expect(
      shouldPruneAutoArtifactRoot("/Users/damon/myWork/AgenticX", opts),
    ).toBe(false);
  });
});
