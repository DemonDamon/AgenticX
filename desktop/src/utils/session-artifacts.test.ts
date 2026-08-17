import { describe, expect, it } from "vitest";
import type { Message, SubAgent } from "../store";
import {
  appendMissingImageMarkdown,
  artifactBaseName,
  artifactHomeRelativeKey,
  collectArtifactPathsFromAgentMessages,
  collectArtifactPathsFromChatMessages,
  collectArtifactPathsFromPersistedSessionFiles,
  collectSessionArtifactPaths,
  parseSessionMessageFilePayload,
  collectTurnPreviewImagePaths,
  collectWorkspaceListingArtifactPaths,
  expandArtifactHomePath,
  isInAppArtifactPreviewPath,
  isInAppHtmlPreviewPath,
  isWalkableWorkspaceArtifactDir,
  looksLikeDirectoryPath,
  pathToFileUrl,
  preferAnimatedPreviewImages,
} from "./session-artifacts";

function toolMsg(partial: Partial<Message> & Pick<Message, "id" | "content">): Message {
  return {
    role: "tool",
    timestamp: 1,
    ...partial,
  };
}

function assistantMsg(partial: Partial<Message> & Pick<Message, "id" | "content">): Message {
  return {
    role: "assistant",
    timestamp: 1,
    ...partial,
  };
}

describe("collectSessionArtifactPaths", () => {
  it("collects file_write path from toolArgs and OK: wrote body", () => {
    const messages: Message[] = [
      toolMsg({
        id: "t1",
        toolName: "file_write",
        toolArgs: { path: "/Users/damon/.agenticx/avatars/x/workspace/charts/a.svg" },
        content: "✅ file_write 结果: OK: wrote /Users/damon/.agenticx/avatars/x/workspace/charts/a.svg",
      }),
      toolMsg({
        id: "t2",
        toolName: "file_edit",
        toolArgs: { path: "/Users/damon/.agenticx/avatars/x/workspace/charts/b.mmd" },
        content: "OK: edited /Users/damon/.agenticx/avatars/x/workspace/charts/b.mmd (120 chars)",
      }),
    ];
    expect(collectSessionArtifactPaths(messages)).toEqual([
      "/Users/damon/.agenticx/avatars/x/workspace/charts/a.svg",
      "/Users/damon/.agenticx/avatars/x/workspace/charts/b.mmd",
    ]);
  });

  it("skips directory-only 保存路径 labels (join base, not an artifact row)", () => {
    const messages: Message[] = [
      assistantMsg({
        id: "a1",
        content: "保存路径：`/Users/damon/.agenticx/avatars/x/workspace/charts/`",
      }),
    ];
    expect(collectSessionArtifactPaths(messages)).toEqual([]);
  });

  it("joins markdown table filenames under 保存路径 directory", () => {
    const messages: Message[] = [
      assistantMsg({
        id: "a1",
        content: [
          "| 文件 | 大小 |",
          "| --- | --- |",
          "| A股科技股后续走势分析框架.mmd | 1.9 KB |",
          "| A股科技股三种情景对比.svg | 8.8 KB |",
          "",
          "保存路径：`/Users/damon/.agenticx/avatars/x/workspace/charts/`",
        ].join("\n"),
      }),
    ];
    expect(collectSessionArtifactPaths(messages)).toEqual([
      "/Users/damon/.agenticx/avatars/x/workspace/charts/A股科技股后续走势分析框架.mmd",
      "/Users/damon/.agenticx/avatars/x/workspace/charts/A股科技股三种情景对比.svg",
    ]);
  });

  it("collects absolute bash redirect targets", () => {
    const messages: Message[] = [
      toolMsg({
        id: "t1",
        toolName: "bash_exec",
        toolArgs: {
          command: "cat > /Users/damon/.agenticx/avatars/x/workspace/charts/c.svg <<'EOF'\n<svg/>\nEOF",
        },
        content: "✅ bash_exec 结果: ok",
      }),
    ];
    expect(collectSessionArtifactPaths(messages)).toEqual([
      "/Users/damon/.agenticx/avatars/x/workspace/charts/c.svg",
    ]);
  });

  it("collects bash_exec JSON stdout output file path (openpyxl-style save)", () => {
    const path =
      "/Users/damon/Desktop/Ai产研管理/售前/广汽/广汽超级程序员一体化平台_成本重新评估_20260720_1648.xlsx";
    const messages: Message[] = [
      toolMsg({
        id: "t1",
        toolName: "bash_exec",
        toolArgs: {
          command: "python3 - <<'PY'\nwb.save(out)\nprint(json.dumps({'output': str(out)}))\nPY",
        },
        content: [
          "exit_code=0",
          "stdout:",
          "{",
          '  "ok": true,',
          `  "output": "${path}",`,
          '  "repo_facts": [',
          '    { "path": "/Users/damon/Desktop/Ai产研管理/项目/aibox/richinfo-code" }',
          "  ]",
          "}",
        ].join("\n"),
      }),
    ];
    expect(collectSessionArtifactPaths(messages)).toEqual([path]);
  });

  it("collects path after 新 Excel 已保存 / 路径： multiline prose", () => {
    const path =
      "/Users/damon/Desktop/Ai产研管理/售前/广汽/广汽超级程序员一体化平台_成本重新评估_20260720_1648.xlsx";
    const messages: Message[] = [
      assistantMsg({
        id: "a1",
        content: [
          "团长，已完成。",
          "",
          "## 1. 新 Excel 已保存",
          "",
          "路径：",
          "",
          `\`${path}\``,
          "",
          "---",
          "",
          "## 2. 口径",
        ].join("\n"),
      }),
    ];
    expect(collectSessionArtifactPaths(messages)).toEqual([path]);
  });

  it("collects same-line 路径： absolute file", () => {
    const path = "/Users/damon/out/quote.xlsx";
    const messages: Message[] = [
      assistantMsg({
        id: "a1",
        content: `路径：\`${path}\``,
      }),
    ];
    expect(collectSessionArtifactPaths(messages)).toEqual([path]);
  });

  it("does not treat prose「…路径」+ hidden dir ~/.codewiki as an artifact", () => {
    const messages: Message[] = [
      assistantMsg({
        id: "a1",
        content: [
          "**关键发现：CodeWiki 自身不生成任何文档内容。** 它只是一个**元数据管理器**：",
          "- `config.rs`：管理 `~/.codewiki/<project>/` 路径",
          "- 实际的 Wiki 文档生成完全依赖外部 AI agent",
        ].join("\n"),
      }),
    ];
    expect(collectSessionArtifactPaths(messages)).toEqual([]);
  });

  it("rejects placeholder paths with <> and pure hidden-dir basenames", () => {
    const messages: Message[] = [
      assistantMsg({
        id: "a1",
        content: "路径：`~/.codewiki/<project>/notes.md`",
      }),
      assistantMsg({
        id: "a2",
        content: "路径：`~/.codewiki`",
      }),
    ];
    expect(collectSessionArtifactPaths(messages)).toEqual([]);
  });

  it("merges sub-agent outputs and extra paths with dedupe", () => {
    const path = "/Users/damon/out/report.md";
    const messages: Message[] = [
      toolMsg({
        id: "t1",
        toolName: "file_write",
        toolArgs: { path },
        content: `OK: wrote ${path}`,
      }),
    ];
    const subAgents: SubAgent[] = [
      {
        id: "s1",
        name: "worker",
        role: "worker",
        status: "completed",
        task: "x",
        resultFile: path,
        outputFiles: ["/Users/damon/out/extra.csv"],
        events: [],
      },
    ];
    expect(collectSessionArtifactPaths(messages, subAgents, [path, "/tmp/pin.bin"])).toEqual([
      path,
      "/Users/damon/out/extra.csv",
      "/tmp/pin.bin",
    ]);
  });

  it("filters by ownerSessionId when provided", () => {
    const messages: Message[] = [
      toolMsg({
        id: "t1",
        ownerSessionId: "sess-a",
        toolName: "file_write",
        toolArgs: { path: "/tmp/a.txt" },
        content: "OK: wrote /tmp/a.txt",
      }),
      toolMsg({
        id: "t2",
        ownerSessionId: "sess-b",
        toolName: "file_write",
        toolArgs: { path: "/tmp/b.txt" },
        content: "OK: wrote /tmp/b.txt",
      }),
    ];
    expect(collectSessionArtifactPaths(messages, null, null, "sess-a")).toEqual(["/tmp/a.txt"]);
  });

  it("dedupes ~/Desktop/file and /Users/<name>/Desktop/file as one artifact", () => {
    const abs = "/Users/damon/Desktop/harness_ai_security_proposal.md";
    const tilde = "~/Desktop/harness_ai_security_proposal.md";
    const messages: Message[] = [
      toolMsg({
        id: "t1",
        toolName: "file_write",
        toolArgs: { path: abs },
        content: `OK: wrote ${abs}`,
      }),
      assistantMsg({
        id: "a1",
        content: `报告已保存至 \`${tilde}\``,
      }),
    ];
    const paths = collectSessionArtifactPaths(messages);
    expect(paths).toEqual([abs]);
  });

  it("upgrades tilde path to absolute when absolute form arrives later", () => {
    const abs = "/Users/damon/Desktop/attack_chain.svg";
    const tilde = "~/Desktop/attack_chain.svg";
    const messages: Message[] = [
      assistantMsg({
        id: "a1",
        content: `已保存至 \`${tilde}\``,
      }),
      toolMsg({
        id: "t1",
        toolName: "file_write",
        toolArgs: { path: abs },
        content: `OK: wrote ${abs}`,
      }),
    ];
    expect(collectSessionArtifactPaths(messages)).toEqual([abs]);
  });
});

describe("collectArtifactPathsFromAgentMessages", () => {
  it("collects HTML from agent_messages tool name + OK: wrote (chat pane gap)", () => {
    const html = "/Users/damon/cursor_billing_report.html";
    const rows = [
      {
        role: "assistant",
        content: " ",
        tool_calls: [
          {
            id: "functions.file_write:24",
            type: "function",
            function: {
              name: "file_write",
              arguments: JSON.stringify({ path: html, content: "<!DOCTYPE html>" }),
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "functions.file_write:24",
        name: "file_write",
        content: `OK: wrote ${html}`,
      },
      {
        role: "assistant",
        content: `## 分析完成\n报告路径：\`${html}\``,
      },
    ];
    expect(collectArtifactPathsFromAgentMessages(rows)).toEqual([html]);
  });

  it("does not collect path when paired tool result is ERROR / path escapes", () => {
    const p = "/Users/damon/myWork/research-agent/requirements.txt";
    const rows = [
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call-edit-1",
            type: "function",
            function: {
              name: "file_edit",
              arguments: JSON.stringify({ path: p, old_str: "a", new_str: "b" }),
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call-edit-1",
        name: "file_edit",
        content: `ERROR: path escapes workspace: ${p}`,
      },
    ];
    expect(collectArtifactPathsFromAgentMessages(rows)).toEqual([]);
  });

  it("collects path when paired tool result is OK: edited", () => {
    const p = "/Users/damon/x/a.txt";
    const rows = [
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call-edit-ok",
            type: "function",
            function: {
              name: "file_edit",
              arguments: JSON.stringify({ path: p, old_str: "a", new_str: "b" }),
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call-edit-ok",
        name: "file_edit",
        content: `OK: edited ${p}`,
      },
    ];
    expect(collectArtifactPathsFromAgentMessages(rows)).toEqual([p]);
  });
});

describe("collectSessionArtifactPaths — successful write only", () => {
  it("skips toolArgs.path when toolStatus is error + ERROR body", () => {
    const p = "/Users/damon/myWork/research-agent/requirements.txt";
    const messages: Message[] = [
      toolMsg({
        id: "t-err",
        toolName: "file_edit",
        toolStatus: "error",
        toolArgs: { path: p },
        content: `ERROR: path escapes workspace: ${p}`,
      }),
    ];
    expect(collectSessionArtifactPaths(messages)).toEqual([]);
  });

  it("collects toolArgs.path when OK: edited and no failure status", () => {
    const p = "/Users/damon/x/a.txt";
    const messages: Message[] = [
      toolMsg({
        id: "t-ok",
        toolName: "file_edit",
        toolStatus: "done",
        toolArgs: { path: p },
        content: `OK: edited ${p}`,
      }),
    ];
    expect(collectSessionArtifactPaths(messages)).toEqual([p]);
  });

  it("still collects when toolStatus is undefined and body is OK: edited", () => {
    const p = "/Users/damon/x/a.txt";
    const messages: Message[] = [
      toolMsg({
        id: "t-legacy",
        toolName: "file_edit",
        toolArgs: { path: p },
        content: `OK: edited ${p}`,
      }),
    ];
    expect(collectSessionArtifactPaths(messages)).toEqual([p]);
  });
});

describe("collectArtifactPathsFromChatMessages (messages.json)", () => {
  it("collects file_write from snake_case chat history rows", () => {
    const svg = "/Users/damon/myWork/oag-deep-research/assets/fig2-open-source-landscape.svg";
    const rows = [
      {
        role: "tool",
        tool_name: "file_write",
        tool_status: "done",
        tool_args: { path: svg, content: "<svg xmlns='huge-payload'/>" },
        content: `OK: wrote ${svg}`,
      },
    ];
    expect(collectArtifactPathsFromChatMessages(rows)).toEqual([svg]);
  });

  it("collects bash_exec absolute path from stdout and labeled assistant save", () => {
    const pdf = "/Users/damon/myWork/oag-deep-research/Palantir本体论产品与开源平替调研报告.pdf";
    const rows = [
      {
        role: "tool",
        tool_name: "bash_exec",
        tool_args: { command: `ls -la "${pdf}"` },
        content: `exit_code=0\nstdout:\n-rw-r--r-- 1 damon staff 2686051 ${pdf}\n`,
      },
      {
        role: "assistant",
        content: `路径：\n\`${pdf}\``,
      },
    ];
    expect(collectArtifactPathsFromChatMessages(rows)).toEqual([pdf]);
  });

  it("does not collect denied file_edit from chat history", () => {
    const p = "/Users/damon/myWork/research-agent/requirements.txt";
    const rows = [
      {
        role: "tool",
        tool_name: "file_edit",
        tool_status: "done",
        tool_args: { path: p },
        content: `ERROR: path escapes workspace: ${p}`,
      },
    ];
    expect(collectArtifactPathsFromChatMessages(rows)).toEqual([]);
  });

  it("accepts { messages: [...] } wrapper payload", () => {
    const md = "/Users/damon/report.md";
    const payload = {
      messages: [
        {
          role: "tool",
          tool_name: "file_write",
          tool_args: { path: md },
          content: `OK: wrote ${md}`,
        },
      ],
    };
    expect(collectArtifactPathsFromChatMessages(parseSessionMessageFilePayload(payload))).toEqual([
      md,
    ]);
  });
});

describe("collectArtifactPathsFromPersistedSessionFiles — tail vs full history", () => {
  it("keeps older writes when agent_messages tail has no file_write", () => {
    const svg = "/Users/damon/myWork/oag-deep-research/assets/fig1-palantir-product-shape.svg";
    const pdf = "/Users/damon/myWork/oag-deep-research/Palantir本体论产品与开源平替调研报告.pdf";
    const chatHistoryRows = [
      {
        role: "tool",
        tool_name: "file_write",
        tool_args: { path: svg },
        content: `OK: wrote ${svg}`,
      },
    ];
    const agentMessageRows = [
      { role: "user", content: "飞书文档也同步改了吗" },
      {
        role: "assistant",
        content: `路径：\n\`${pdf}\``,
      },
    ];
    expect(
      collectArtifactPathsFromPersistedSessionFiles({
        chatHistoryRows,
        agentMessageRows,
      }),
    ).toEqual([svg, pdf]);
  });
});

describe("denied write must not become an artifact", () => {
  it("reproduces privilege-escalation accident: denied file_edit is not collected", () => {
    const p = "/Users/damon/myWork/research-agent/requirements.txt";
    const rows = [
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "functions.file_edit:denied",
            type: "function",
            function: {
              name: "file_edit",
              arguments: JSON.stringify({
                path: p,
                old_str: "langchain>=0.1.0",
                new_str: "langchain>=0.1.0\ntorch==2.2.0",
              }),
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "functions.file_edit:denied",
        name: "file_edit",
        content: `ERROR: path escapes workspace: ${p}`,
      },
    ];
    expect(collectArtifactPathsFromAgentMessages(rows)).toEqual([]);

    const paneMessages: Message[] = [
      toolMsg({
        id: "pane-denied",
        toolName: "file_edit",
        toolStatus: "error",
        toolArgs: { path: p },
        content: `ERROR: path escapes workspace: ${p}`,
      }),
    ];
    expect(collectSessionArtifactPaths(paneMessages)).toEqual([]);
  });
});

describe("artifact helpers", () => {
  it("expandArtifactHomePath and artifactHomeRelativeKey", () => {
    expect(expandArtifactHomePath("~/Desktop/a.md", "/Users/damon")).toBe(
      "/Users/damon/Desktop/a.md",
    );
    expect(artifactHomeRelativeKey("/Users/damon/Desktop/a.md")).toBe("~/Desktop/a.md");
    expect(artifactHomeRelativeKey("~/Desktop/a.md")).toBe("~/Desktop/a.md");
    expect(artifactHomeRelativeKey("/tmp/a.md")).toBeNull();
  });

  it("artifactBaseName", () => {
    expect(artifactBaseName("/a/b/c.svg")).toBe("c.svg");
    expect(artifactBaseName("/a/b/charts/")).toBe("charts");
  });

  it("looksLikeDirectoryPath", () => {
    expect(looksLikeDirectoryPath("/Users/x/charts/")).toBe(true);
    expect(looksLikeDirectoryPath("/Users/x/charts")).toBe(true);
    expect(looksLikeDirectoryPath("/Users/x/charts/a.svg")).toBe(false);
  });

  it("isInAppHtmlPreviewPath", () => {
    expect(isInAppHtmlPreviewPath("/tmp/report.html")).toBe(true);
    expect(isInAppHtmlPreviewPath("/tmp/Report.HTM")).toBe(true);
    expect(isInAppHtmlPreviewPath("/tmp/a.svg")).toBe(false);
  });

  it("isInAppArtifactPreviewPath", () => {
    expect(isInAppArtifactPreviewPath("/tmp/a.svg")).toBe(true);
    expect(isInAppArtifactPreviewPath("/tmp/a.mmd")).toBe(true);
    expect(isInAppArtifactPreviewPath("/tmp/a.pdf")).toBe(true);
    expect(isInAppArtifactPreviewPath("/tmp/a.docx")).toBe(true);
    expect(isInAppArtifactPreviewPath("/tmp/report.html")).toBe(false);
    expect(isInAppArtifactPreviewPath("/tmp/charts/")).toBe(false);
  });

  it("pathToFileUrl", () => {
    expect(pathToFileUrl("/Users/damon/a.html")).toBe("file:///Users/damon/a.html");
    expect(pathToFileUrl("C:/Users/damon/a.html")).toBe("file:///C:/Users/damon/a.html");
  });
});

describe("collectSessionArtifactPaths — bash stdout + table cells", () => {
  const gif =
    "/Users/damon/.agenticx/taskspaces/35ca2867-f843-4013-bfc2-d328c35d2427/default/archscribe-login/login-swimlane.gif";
  const png =
    "/Users/damon/.agenticx/taskspaces/35ca2867-f843-4013-bfc2-d328c35d2427/default/archscribe-login/login-swimlane.png";
  const svg =
    "/Users/damon/.agenticx/taskspaces/35ca2867-f843-4013-bfc2-d328c35d2427/default/archscribe-login/login-swimlane.svg";

  it("collects absolute image paths echoed in bash_exec stdout (no redirect / no JSON output)", () => {
    const messages: Message[] = [
      toolMsg({
        id: "t-ls",
        toolName: "bash_exec",
        toolArgs: {
          command:
            'OUTPUT_DIR="/Users/damon/.agenticx/taskspaces/35ca2867-f843-4013-bfc2-d328c35d2427/default/archscribe-login"\necho "GIF: $OUTPUT_DIR/login-swimlane.gif"',
        },
        content: [
          "exit_code=0",
          "stdout:",
          "=== 文件路径 ===",
          `PNG: ${png}`,
          `GIF: ${gif}`,
          `SVG: ${svg}`,
          "stderr:",
          "(empty)",
        ].join("\n"),
      }),
    ];
    expect(collectSessionArtifactPaths(messages)).toEqual([png, gif, svg]);
  });

  it("does not collect skill source files listed by find/ls in bash stdout", () => {
    const messages: Message[] = [
      toolMsg({
        id: "t-find",
        toolName: "bash_exec",
        toolArgs: { command: "find ~/.agenticx/skills/registry/archscribe -type f" },
        content: [
          "exit_code=0",
          "stdout:",
          "/Users/damon/.agenticx/skills/registry/archscribe/SKILL.md",
          "/Users/damon/.agenticx/skills/registry/archscribe/scripts/render_animated_diagram.py",
        ].join("\n"),
      }),
    ];
    expect(collectSessionArtifactPaths(messages)).toEqual([]);
  });

  it("joins table filenames in any column under 路径： directory", () => {
    const messages: Message[] = [
      assistantMsg({
        id: "a-final",
        content: [
          "### 产出文件",
          "",
          "| 格式 | 文件名 | 大小 |",
          "|---|---|---|",
          "| PNG（静态） | `login-swimlane.png` | 274 KB |",
          "| GIF（动画） | `login-swimlane.gif` | 702 KB |",
          "| SVG（矢量） | `login-swimlane.svg` | 2.8 MB |",
          "",
          "路径：`/Users/damon/.agenticx/taskspaces/35ca2867-f843-4013-bfc2-d328c35d2427/default/archscribe-login/`",
        ].join("\n"),
      }),
    ];
    expect(collectSessionArtifactPaths(messages)).toEqual([png, gif, svg]);
  });
});

describe("turn preview images", () => {
  it("prefers animated gif over png/svg with the same stem", () => {
    const dir =
      "/Users/damon/.agenticx/taskspaces/s/default/archscribe-login";
    expect(
      preferAnimatedPreviewImages([
        `${dir}/login-swimlane.png`,
        `${dir}/login-swimlane.gif`,
        `${dir}/login-swimlane.svg`,
        `${dir}/login-swimlane-spec.json`,
      ]),
    ).toEqual([`${dir}/login-swimlane.gif`]);
  });

  it("appends markdown images only for paths not already in the body", () => {
    const gif = "/Users/damon/out/login-swimlane.gif";
    const png = "/Users/damon/out/other.png";
    const body = `已生成\n\n![已有](${gif})`;
    expect(appendMissingImageMarkdown(body, [gif, png])).toBe(
      `${body}\n\n![other.png](${png})`,
    );
  });

  it("collectTurnPreviewImagePaths only embeds on the last assistant of the turn", () => {
    const gif =
      "/Users/damon/.agenticx/taskspaces/s/default/archscribe-login/login-swimlane.gif";
    const messages: Message[] = [
      assistantMsg({ id: "mid", content: "渲染中" }),
      toolMsg({
        id: "t-out",
        toolName: "bash_exec",
        toolArgs: { command: "ls" },
        content: `GIF: ${gif}`,
      }),
      assistantMsg({ id: "final", content: "完成" }),
    ];
    expect(collectTurnPreviewImagePaths(messages, "mid")).toEqual([]);
    expect(collectTurnPreviewImagePaths(messages, "final")).toEqual([gif]);
  });
});

describe("default workspace listing → 任务产物", () => {
  const root =
    "/Users/damon/.agenticx/taskspaces/33a3bc2a-d494-493f-a62a-e29a3b4f027d/default";

  it("keeps root files like parent-kid-games.html and skips memory/", () => {
    expect(
      collectWorkspaceListingArtifactPaths({
        workspaceRoot: root,
        entries: [
          { name: "memory", type: "dir", path: "memory" },
          { name: "parent-kid-games.html", type: "file", path: "parent-kid-games.html" },
        ],
      }),
    ).toEqual([`${root}/parent-kid-games.html`]);
  });

  it("skips hidden files and extensionless names", () => {
    expect(
      collectWorkspaceListingArtifactPaths({
        workspaceRoot: root,
        entries: [
          { name: ".DS_Store", type: "file", path: ".DS_Store" },
          { name: "README", type: "file", path: "README" },
          { name: "notes.md", type: "file", path: "notes.md" },
        ],
      }),
    ).toEqual([`${root}/notes.md`]);
  });

  it("does not walk memory, hidden, or mounted dirs", () => {
    expect(isWalkableWorkspaceArtifactDir({ name: "memory", type: "dir" })).toBe(false);
    expect(isWalkableWorkspaceArtifactDir({ name: ".git", type: "dir" })).toBe(false);
    expect(
      isWalkableWorkspaceArtifactDir({
        name: "external-repo",
        type: "dir",
        mount_mode: "reference",
      }),
    ).toBe(false);
    expect(isWalkableWorkspaceArtifactDir({ name: "output", type: "dir" })).toBe(true);
  });
});
