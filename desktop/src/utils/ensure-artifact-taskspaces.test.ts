import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SESSION_TASK_ARTIFACTS_DIRNAME,
  SESSION_TASK_ARTIFACTS_LABEL,
  WORKSPACE_ARTIFACT_RESYNC_MS,
  ensureArtifactTaskspacesForSession,
  loadPersistedSessionArtifactPaths,
  sessionTaskArtifactsDir,
  shouldPruneAutoArtifactRoot,
  startPersistedArtifactPathResync,
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

  it("merges default-workspace files when group chat history has no file_write rows", async () => {
    const sid = "33a3bc2a-d494-493f-a62a-e29a3b4f027d";
    const root = `/Users/damon/.agenticx/taskspaces/${sid}/default`;
    const html = `${root}/parent-kid-games.html`;
    const loadSessionMessages = vi.fn(async () => ({
      ok: true,
      messages: [
        { role: "user", content: "做个亲子小游戏" },
        { role: "assistant", content: "原型已交付：`parent-kid-games.html`" },
      ],
    }));
    const readLocalTextFile = vi.fn(async () => ({ ok: true, content: "[]" }));
    const listTaskspaces = vi.fn(async () => ({
      ok: true,
      workspaces: [{ id: "default", path: root, label: "default" }],
    }));
    const listTaskspaceFiles = vi.fn(async () => ({
      ok: true,
      files: [
        { name: "memory", type: "dir", path: "memory", size: 0, modified: 0 },
        {
          name: "parent-kid-games.html",
          type: "file",
          path: "parent-kid-games.html",
          size: 12,
          modified: 0,
        },
      ],
    }));
    vi.stubGlobal("window", {
      agenticxDesktop: {
        loadSessionMessages,
        readLocalTextFile,
        listTaskspaces,
        listTaskspaceFiles,
      },
    });

    const paths = await loadPersistedSessionArtifactPaths(sid);
    expect(paths).toEqual([html]);
    expect(listTaskspaceFiles).toHaveBeenCalledTimes(1);
    expect(listTaskspaceFiles).toHaveBeenCalledWith({
      sessionId: sid,
      taskspaceId: "default",
      path: ".",
    });
  });

  it("walks a regular subdir but not memory/", async () => {
    const sid = "group-walk";
    const root = `/Users/damon/.agenticx/taskspaces/${sid}/default`;
    const nested = `${root}/games/board.html`;
    const listTaskspaceFiles = vi.fn(async (payload: { path?: string }) => {
      if (payload.path === "games") {
        return {
          ok: true,
          files: [
            { name: "board.html", type: "file", path: "games/board.html", size: 1, modified: 0 },
          ],
        };
      }
      return {
        ok: true,
        files: [
          { name: "memory", type: "dir", path: "memory", size: 0, modified: 0 },
          { name: "games", type: "dir", path: "games", size: 0, modified: 0 },
        ],
      };
    });
    vi.stubGlobal("window", {
      agenticxDesktop: {
        loadSessionMessages: vi.fn(async () => ({ ok: true, messages: [] })),
        readLocalTextFile: vi.fn(async () => ({ ok: true, content: "[]" })),
        listTaskspaces: vi.fn(async () => ({
          ok: true,
          workspaces: [{ id: "default", path: root, label: "default" }],
        })),
        listTaskspaceFiles,
      },
    });

    const paths = await loadPersistedSessionArtifactPaths(sid);
    expect(paths).toEqual([nested]);
    expect(listTaskspaceFiles.mock.calls.map((c) => c[0]?.path)).toEqual([".", "games"]);
  });

  it("lists both root HTML files from a later workspace listing", async () => {
    const sid = "33a3bc2a-d494-493f-a62a-e29a3b4f027d";
    const root = `/Users/damon/.agenticx/taskspaces/${sid}/default`;
    vi.stubGlobal("window", {
      agenticxDesktop: {
        loadSessionMessages: vi.fn(async () => ({
          ok: true,
          messages: [
            { role: "assistant", content: "文件已生成：**tank-battle.html**" },
          ],
        })),
        readLocalTextFile: vi.fn(async () => ({ ok: true, content: "[]" })),
        listTaskspaces: vi.fn(async () => ({
          ok: true,
          workspaces: [{ id: "default", path: root, label: "default" }],
        })),
        listTaskspaceFiles: vi.fn(async () => ({
          ok: true,
          files: [
            { name: "memory", type: "dir", path: "memory", size: 0, modified: 0 },
            {
              name: "parent-kid-games.html",
              type: "file",
              path: "parent-kid-games.html",
              size: 12,
              modified: 0,
            },
            {
              name: "tank-battle.html",
              type: "file",
              path: "tank-battle.html",
              size: 20,
              modified: 0,
            },
          ],
        })),
      },
    });

    await expect(loadPersistedSessionArtifactPaths(sid)).resolves.toEqual([
      `${root}/parent-kid-games.html`,
      `${root}/tank-battle.html`,
    ]);
  });
});

describe("startPersistedArtifactPathResync", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("rescans after the workspace poll interval so a later HTML is listed", async () => {
    vi.useFakeTimers();
    const sid = "group-resync";
    let files = ["parent-kid-games.html"];
    const load = vi.fn(async () => files.map((name) => `/tmp/${sid}/${name}`));
    const onPaths = vi.fn();

    const stop = startPersistedArtifactPathResync({
      sessionId: sid,
      enabled: true,
      load,
      onPaths,
    });

    await Promise.resolve();
    expect(onPaths).toHaveBeenCalledTimes(1);
    expect(onPaths).toHaveBeenLastCalledWith([`/tmp/${sid}/parent-kid-games.html`]);

    files = ["parent-kid-games.html", "tank-battle.html"];
    await vi.advanceTimersByTimeAsync(WORKSPACE_ARTIFACT_RESYNC_MS);
    expect(onPaths).toHaveBeenLastCalledWith([
      `/tmp/${sid}/parent-kid-games.html`,
      `/tmp/${sid}/tank-battle.html`,
    ]);
    stop();
  });

  it("does not poll when summary is closed", async () => {
    vi.useFakeTimers();
    const load = vi.fn(async () => ["/tmp/a.html"]);
    const onPaths = vi.fn();
    const stop = startPersistedArtifactPathResync({
      sessionId: "s1",
      enabled: false,
      load,
      onPaths,
    });
    await vi.runOnlyPendingTimersAsync();
    expect(load).not.toHaveBeenCalled();
    expect(onPaths).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(WORKSPACE_ARTIFACT_RESYNC_MS);
    expect(load).not.toHaveBeenCalled();
    stop();
  });
});
