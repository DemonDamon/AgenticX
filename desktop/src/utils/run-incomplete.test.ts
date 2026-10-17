/**
 * Unit tests for run-incomplete detection semantics (P1.3).
 *
 * Author: Damon Li
 */

import { describe, expect, it } from "vitest";

import type { Message } from "../store";
import {
  findRunIncompleteInMessages,
  readRoundsExhaustedMeta,
} from "./run-incomplete";

const msg = (partial: Partial<Message> & { role: Message["role"] }): Message =>
  partial as Message;

describe("readRoundsExhaustedMeta", () => {
  it("reads the marker from assistant metadata", () => {
    const meta = readRoundsExhaustedMeta(
      msg({
        role: "assistant",
        content: "done",
        metadata: { rounds_exhausted: true, round: 30, max_rounds: 30 },
      }),
    );
    expect(meta).toEqual({ round: 30, maxRounds: 30 });
  });

  it("ignores non-assistant rows and rows without the marker", () => {
    expect(readRoundsExhaustedMeta(msg({ role: "tool", content: "x" }))).toBeNull();
    expect(
      readRoundsExhaustedMeta(msg({ role: "assistant", content: "x", metadata: {} })),
    ).toBeNull();
  });
});

describe("findRunIncompleteInMessages", () => {
  it("flags a session whose last run died by token budget", () => {
    const out = findRunIncompleteInMessages([
      msg({ role: "user", content: "写 HTML" }),
      msg({ role: "assistant", content: "读取文档…" }),
      msg({ role: "tool", content: "模型调用失败：Token budget exceeded (500908/500000)。" }),
    ]);
    expect(out).toEqual({ kind: "token_budget" });
  });

  it("flags a last-round silent truncation final", () => {
    const out = findRunIncompleteInMessages([
      msg({ role: "user", content: "继续" }),
      msg({
        role: "assistant",
        content: "以上是部分结果",
        metadata: { rounds_exhausted: true, round: 30, max_rounds: 30 },
      }),
    ]);
    expect(out).toEqual({ kind: "rounds_final" });
  });

  it("flags a rounds-exhausted error notice", () => {
    const out = findRunIncompleteInMessages([
      msg({ role: "user", content: "继续" }),
      msg({
        role: "tool",
        content: "已达到最大工具调用轮数 (30/30)。",
        noticeKind: "rounds_exhausted",
        roundsRound: 30,
        roundsMax: 30,
      }),
    ]);
    expect(out).toEqual({ kind: "rounds_exhausted" });
  });

  it("clears the flag when a later run completed normally after the death", () => {
    const out = findRunIncompleteInMessages([
      msg({ role: "user", content: "写 HTML" }),
      msg({ role: "tool", content: "Token budget exceeded (500908/500000, source=session)." }),
      msg({ role: "user", content: "【原始目标】继续完成" }),
      msg({ role: "assistant", content: "继续追加业务区 2。", metadata: { turn_terminal: false } }),
      msg({
        role: "assistant",
        content: "四个业务区已经全部追加完成，文件已落盘。",
        metadata: { turn_terminal: true, terminal_reason: "model_final" },
      }),
    ]);
    expect(out).toBeNull();
  });

  it("keeps the flag when the turn after the death never reached a terminal reply", () => {
    const out = findRunIncompleteInMessages([
      msg({ role: "user", content: "写 HTML" }),
      msg({ role: "tool", content: "Token budget exceeded (500908/500000, source=session)." }),
      msg({ role: "user", content: "继续" }),
      msg({ role: "assistant", content: "", metadata: { turn_terminal: false } }),
      msg({ role: "assistant", content: "<think>用户要求我继续…</think>", metadata: { turn_terminal: false } }),
    ]);
    expect(out).toEqual({ kind: "token_budget" });
  });

  it("returns null for a session that never died", () => {
    const out = findRunIncompleteInMessages([
      msg({ role: "user", content: "写个文件" }),
      msg({ role: "assistant", content: "已保存 hello.txt。" }),
    ]);
    expect(out).toBeNull();
  });
});
