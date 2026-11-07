/**
 * Exclusive harness brand marks (Damon SVGs under assets/harness/).
 * Vite imports resolve to URL strings usable in <img src>.
 * AgenticX / python-agent uses the Near desktop app icon.
 */

import agenticxMark from "../../assets/harness/agenticx.png";
import claudeCodeMark from "../../assets/harness/claude-code.svg";
import codebuddyMark from "../../assets/harness/codebuddy.svg";
import codexMark from "../../assets/harness/codex.svg";
import deepseekMark from "../../assets/harness/deepseek.svg";
import hermesAgentMark from "../../assets/harness/hermes-agent.svg";
import openclawMark from "../../assets/harness/openclaw.svg";
import opencodeMark from "../../assets/harness/opencode.svg";
import piAgentMark from "../../assets/harness/pi-agent.svg";

import { canonicalizeHarnessId } from "../../utils/harness-display";
import { BUILTIN_HARNESS_ID } from "../../utils/preferred-harness";

const MARK_BY_ID: Record<string, string> = {
  [BUILTIN_HARNESS_ID]: agenticxMark,
  "claude-code": claudeCodeMark,
  codebuddy: codebuddyMark,
  codex: codexMark,
  deepseek: deepseekMark,
  "hermes-agent": hermesAgentMark,
  openclaw: openclawMark,
  opencode: opencodeMark,
  "pi-agent": piAgentMark,
};

/** URL for the harness mark image (Near app icon for AgenticX). */
export function harnessMarkSrc(harnessId: string | null | undefined): string | null {
  const id = canonicalizeHarnessId(harnessId);
  return MARK_BY_ID[id] ?? null;
}

export function hasExclusiveHarnessMark(harnessId: string | null | undefined): boolean {
  return harnessMarkSrc(harnessId) != null;
}
