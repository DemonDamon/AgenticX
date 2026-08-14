import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SESSION_TASK_ARTIFACTS_DIRNAME,
  SESSION_TASK_ARTIFACTS_LABEL,
  ensureArtifactTaskspacesForSession,
  loadPersistedSessionArtifactPaths,
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

  it("prunes the legacy staging /「任务产物」root", () => {
    expect(shouldPruneAutoArtifactRoot(staging, opts)).toBe(true);
    expect(
      shouldPruneAutoArtifactRoot("/Users/damon/projects", {
        ...opts,
        label: SESSION_TASK_ARTIFACTS_LABEL,
      }),
    ).toBe(true);
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

describe("ensureArtifactTaskspacesForSession", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("calls linker with mode reference", async () => {
    const linkIntoSessionWorkspace = vi.fn(
      async (_payload: {
        sessionId: string;
        sources: string[];
        mode?: string;
      }) => ({
        ok: true,
        linked: 1,
        defaultDir: "/tmp/d",
      }),
    );
    const listTaskspaces = vi.fn(async () => ({
      ok: true,
      workspaces: [{ id: "default", path: "/tmp/d", label: "default" }],
    }));
    vi.stubGlobal("window", {
      agenticxDesktop: {
        listTaskspaces,
        linkIntoSessionWorkspace,
      },
      dispatchEvent: vi.fn(() => true),
    });
    if (typeof globalThis.CustomEvent === "undefined") {
      vi.stubGlobal(
        "CustomEvent",
        class CustomEvent {
          type: string;
          detail: unknown;
          constructor(type: string, init?: { detail?: unknown }) {
            this.type = type;
            this.detail = init?.detail;
          }
        },
      );
    }

    const result = await ensureArtifactTaskspacesForSession("sess-1", [
      "/Users/damon/x/a.txt",
    ]);
    expect(result.ok).toBe(true);
    expect(linkIntoSessionWorkspace).toHaveBeenCalledTimes(1);
    expect(linkIntoSessionWorkspace.mock.calls[0]?.[0]).toMatchObject({
      sessionId: "sess-1",
      sources: ["/Users/damon/x/a.txt"],
      mode: "reference",
    });
  });

  it("does not call linker when paths are empty", async () => {
    const linkIntoSessionWorkspace = vi.fn(async () => ({
      ok: true,
      linked: 0,
      defaultDir: "/tmp/d",
    }));
    const listTaskspaces = vi.fn(async () => ({
      ok: true,
      workspaces: [{ id: "default", path: "/tmp/d", label: "default" }],
    }));
    vi.stubGlobal("window", {
      agenticxDesktop: {
        listTaskspaces,
        linkIntoSessionWorkspace,
      },
      dispatchEvent: vi.fn(() => true),
    });

    const result = await ensureArtifactTaskspacesForSession("sess-1", []);
    expect(result.ok).toBe(true);
    expect(linkIntoSessionWorkspace).not.toHaveBeenCalled();
  });
});

describe("loadPersistedSessionArtifactPaths", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses loadSessionMessages so a >512KB messages.json still yields older writes", async () => {
    const svg = "/Users/damon/myWork/oag-deep-research/assets/fig2-open-source-landscape.svg";
    const pdf = "/Users/damon/myWork/oag-deep-research/Palantir本体论产品与开源平替调研报告.pdf";
    const readLocalTextFile = vi.fn(async (rel: string) => {
      if (/\/messages\.json$/.test(String(rel))) {
        return { ok: false, error: "file too large to read (994304 bytes)" };
      }
      return {
        ok: true,
        content: JSON.stringify([
          { role: "user", content: "飞书文档也同步改了吗" },
          { role: "assistant", content: `路径：\n\`${pdf}\`` },
        ]),
      };
    });
    const loadSessionMessages = vi.fn(async () => ({
      ok: true,
      messages: [
        {
          role: "tool",
          tool_name: "file_write",
          tool_args: { path: svg, content: "<svg/>" },
          content: `OK: wrote ${svg}`,
        },
      ],
    }));
    vi.stubGlobal("window", {
      agenticxDesktop: {
        loadSessionMessages,
        readLocalTextFile,
      },
    });

    const paths = await loadPersistedSessionArtifactPaths("aacf581b-eab0-4add-9196-5099945a690b");
    expect(loadSessionMessages).toHaveBeenCalledWith("aacf581b-eab0-4add-9196-5099945a690b");
    expect(readLocalTextFile.mock.calls.map((c) => c[0])).toEqual([
      "~/.agenticx/sessions/aacf581b-eab0-4add-9196-5099945a690b/agent_messages.json",
    ]);
    expect(paths).toEqual([svg, pdf]);
  });
});
