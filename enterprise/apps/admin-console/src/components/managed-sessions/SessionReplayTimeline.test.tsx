import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import zh from "../../../messages/zh.json";
import { buildReplayTimeline } from "../../lib/ma-session-console";
import { SessionReplayTimeline } from "./SessionReplayTimeline";

const messages = {
  pages: {
    ops: {
      managedSessions: zh.pages.ops.managedSessions,
    },
  },
};

function render(items: ReturnType<typeof buildReplayTimeline>) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="zh" timeZone="Asia/Shanghai" messages={messages}>
      <SessionReplayTimeline items={items} />
    </NextIntlClientProvider>,
  );
}

const pairedEvents: Record<string, unknown>[] = [
  {
    type: "span.model_request_start",
    id: "MS",
    seq: 3,
    created_at: "2026-10-25T00:00:00.000Z",
    model: "m",
  },
  {
    type: "agent.tool_use",
    id: "T",
    seq: 4,
    created_at: "2026-10-25T00:00:00.000Z",
    name: "bash_exec",
    input: { cmd: "ls" },
  },
  {
    type: "agent.tool_result",
    id: "R",
    seq: 5,
    created_at: "2026-10-25T00:00:01.500Z",
    tool_use_id: "T",
    is_error: false,
    content: [{ type: "text", text: "ok" }],
  },
  {
    type: "span.model_request_end",
    id: "ME",
    seq: 6,
    created_at: "2026-10-25T00:00:02.000Z",
    model: "m",
    model_usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2 },
  },
  {
    type: "session.thread_created",
    id: "TH",
    seq: 8,
    created_at: "2026-10-25T00:00:02.500Z",
  },
  {
    type: "session.status_idle",
    id: "I",
    seq: 9,
    created_at: "2026-10-25T00:00:03.000Z",
    stop_reason: { type: "end_turn", event_ids: [] },
  },
];

describe("SessionReplayTimeline", () => {
  it("renders folded tool calls, duration, stop reason and model requests", () => {
    const html = render(buildReplayTimeline(pairedEvents));
    expect(html).toContain("bash_exec");
    expect(html).toContain("1.5 秒");
    expect(html).toContain("正常结束");
    expect(html).toContain("模型请求");
    const tags = html.match(/<details/g) ?? [];
    const closed = html.match(/<details(?![^>]*\sopen)/g) ?? [];
    expect(tags.length).toBeGreaterThan(0);
    expect(closed.length).toBe(tags.length);
  });

  it("clips long tool results and offers expand", () => {
    const payload = "a".repeat(5000);
    const html = render(
      buildReplayTimeline([
        {
          type: "agent.tool_use",
          id: "T",
          seq: 1,
          created_at: "2026-10-25T00:00:00.000Z",
          name: "bash_exec",
          input: {},
        },
        {
          type: "agent.tool_result",
          id: "R",
          seq: 2,
          created_at: "2026-10-25T00:00:01.000Z",
          tool_use_id: "T",
          is_error: false,
          content: [{ type: "text", text: payload }],
        },
      ]),
    );
    expect(html).toContain(`${"a".repeat(4000)}…`);
    expect(html).not.toContain("a".repeat(4001));
    expect(html).toContain("展开全部");
    const tags = html.match(/<details/g) ?? [];
    const closed = html.match(/<details(?![^>]*\sopen)/g) ?? [];
    expect(closed.length).toBe(tags.length);
  });
});
