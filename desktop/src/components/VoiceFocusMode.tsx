import { Mic, Wrench } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "../store";
import type { VoiceProviderKind, VoiceRealtimeEmit, VoiceHistoryTurn, VoiceToolScope } from "../voice/realtime";
import { createRealtimeVoiceSession } from "../voice/realtime";
import { runMetaTurnViaChat } from "../voice/realtime/meta-bridge";
import { mapLoadedSessionMessage, type LoadedSessionMessage } from "../utils/session-message-map";

/** 历史注入上限：与 AGENTS.md 中和用户确认的「最近 20 轮」一致（≈40 条 user/assistant）。 */
const FOCUS_MODE_HISTORY_TURNS = 20;

import "../styles/voice-focus.css";

type VoiceVoiceFlags = { openai_ready?: boolean; doubao_ready?: boolean; provider?: string };

async function fetchVoicePack(apiBase: string, apiToken: string): Promise<{
  voice: Record<string, unknown>;
  flags: VoiceVoiceFlags;
}> {
  const base = apiBase.replace(/\/+$/, "");
  const resp = await fetch(`${base}/api/voice/settings`, {
    headers: {
      "Content-Type": "application/json",
      "x-agx-desktop-token": apiToken,
    },
  });
  if (!resp.ok) throw new Error(`/api/voice/settings HTTP ${resp.status}`);
  const body = (await resp.json()) as { voice?: Record<string, unknown>; voice_flags?: VoiceVoiceFlags };
  return {
    voice: body.voice && typeof body.voice === "object" ? body.voice : {},
    flags: body.voice_flags && typeof body.voice_flags === "object" ? body.voice_flags : {},
  };
}

async function appendVoiceTurn(
  apiBase: string,
  apiToken: string,
  sessionId: string,
  items: Array<{
    role: "user" | "assistant" | "tool";
    content: string;
    metadata?: Record<string, unknown>;
    tool_call_id?: string;
    tool_name?: string;
    tool_args?: Record<string, unknown>;
    tool_status?: "ok" | "error";
    tool_result_preview?: string;
  }>
): Promise<void> {
  if (!items.length) return;
  const base = apiBase.replace(/\/+$/, "");
  const wrapped = items.map((r) => ({ ...r, metadata: { source: "voice-focus", ...(r.metadata ?? {}) } }));
  const resp = await fetch(`${base}/api/session/messages/append`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-agx-desktop-token": apiToken,
    },
    body: JSON.stringify({
      session_id: sessionId,
      messages: wrapped,
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`messages/append HTTP ${resp.status} ${body.slice(0, 200)}`);
  }
  const data = (await resp.json().catch(() => ({}))) as { appended?: number };
  // eslint-disable-next-line no-console
  console.info("[voice-focus] append ok", {
    sessionId,
    roles: items.map((i) => i.role),
    appended: data.appended,
  });
}

/**
 * 拉取目标 session 最近 N 轮历史并归一化为 VoiceHistoryTurn 列表。
 *
 * 失败时返回空数组而非抛错：历史只是「锦上添花」的上下文，不应阻断
 * 进入电话；UI 仍能正常发起 realtime 会话（豆包/OpenAI 视为新对话）。
 */
async function fetchSessionHistory(
  apiBase: string,
  apiToken: string,
  sessionId: string,
  maxTurns: number
): Promise<VoiceHistoryTurn[]> {
  if (!sessionId.trim()) return [];
  try {
    const base = apiBase.replace(/\/+$/, "");
    const resp = await fetch(
      `${base}/api/session/messages?session_id=${encodeURIComponent(sessionId)}`,
      { headers: { "x-agx-desktop-token": apiToken } }
    );
    if (!resp.ok) return [];
    const body = (await resp.json()) as { messages?: Array<Record<string, unknown>> };
    const raw = Array.isArray(body.messages) ? body.messages : [];
    const turns: VoiceHistoryTurn[] = [];
    for (const m of raw) {
      const role = String((m.role as string) ?? "").trim();
      const content = String((m.content as string) ?? "").trim();
      if (!content) continue;
      if (role !== "user" && role !== "assistant") continue;
      turns.push({ role, content });
    }
    // 取最近 N 轮：以 user/assistant 对作为「一轮」近似估算，简单按消息条数 2N 截断。
    const sliceFrom = Math.max(0, turns.length - maxTurns * 2);
    return turns.slice(sliceFrom);
  } catch {
    return [];
  }
}

/** 圆形语音胶囊 UI + Realtime/OpenSpeech 链路（不写 plan 所述「假波形」占位，柱状条由 mic/out 音量驱动）。 */
function readVoiceToolScope(voice: Record<string, unknown>): VoiceToolScope {
  const raw = String(voice.tool_scope ?? "").trim().toLowerCase();
  return raw === "advanced" ? "advanced" : "default";
}

/** 仅用于读屏：界面不展示状态文案 */
function voiceFocusPhaseAria(phase: string): string {
  switch (phase) {
    case "listening":
      return "正在收听";
    case "thinking":
      return "思考中";
    case "speaking":
      return "正在播报回复";
    case "tool_running":
      return "正在执行工具";
    case "idle":
      return "连接中";
    case "error":
      return "出现异常";
    default:
      return "语音会话";
  }
}

export function VoiceFocusMode() {
  const panes = useAppStore((s) => s.panes);
  const focusModePaneId = useAppStore((s) => s.focusModePaneId);
  const exitFocusMode = useAppStore((s) => s.exitFocusMode);
  const openSettings = useAppStore((s) => s.openSettings);
  const apiBase = useAppStore((s) => s.apiBase);
  const apiToken = useAppStore((s) => s.apiToken);
  const setPaneMessages = useAppStore((s) => s.setPaneMessages);
  const setPaneSessionId = useAppStore((s) => s.setPaneSessionId);

  /**
   * 解析「目标会话」：
   *   - 优先用 store.focusModePaneId（由触发的 ChatPane 拨号按钮 / 快捷键写入）；
   *   - 找不到时回落到 pane-meta，避免历史会话丢失。
   * 该 sessionId 同时作为：(a) 历史拉取入参，(b) user_final / assistant_final 写回目标，
   * targetPaneId 则用于挂断后向该 pane 主动 push 一次磁盘消息刷新。
   */
  const { targetPaneId, targetSessionId: storeTargetSessionId, targetAvatarId } = useMemo(() => {
    const targetPane =
      panes.find((p) => p.id === focusModePaneId) ?? panes.find((p) => p.id === "pane-meta");
    return {
      targetPaneId: targetPane?.id ?? "pane-meta",
      targetSessionId: String(targetPane?.sessionId ?? "").trim(),
      targetAvatarId: String(targetPane?.avatarId ?? "").trim() || null,
    };
  }, [panes, focusModePaneId]);
  const [runtimeTargetSessionId, setRuntimeTargetSessionId] = useState<string>("");
  const targetSessionId = runtimeTargetSessionId || storeTargetSessionId;
  const targetSessionIdRef = useRef(targetSessionId);
  useEffect(() => {
    targetSessionIdRef.current = targetSessionId;
  }, [targetSessionId]);

  const [voiceKind, setVoiceKind] = useState<VoiceProviderKind | null>(null);
  /** 默认 ON：进电话即工具桥接武装。Wrench 用来关掉它退回纯豆包对话。 */
  const [bridgeArmed, setBridgeArmed] = useState(true);
  const [bridgeHint, setBridgeHint] = useState<{
    text: string;
    isError: boolean;
    fullText?: string;
  } | null>(null);

  const bridgeArmedRef = useRef(bridgeArmed);
  useEffect(() => {
    bridgeArmedRef.current = bridgeArmed;
  }, [bridgeArmed]);

  const bridgeAbortRef = useRef<AbortController | null>(null);
  const unsubUserFinalRef = useRef<(() => void) | null>(null);
  const bridgeHintTimerRef = useRef<number | null>(null);
  /** Stable refs for callbacks used inside bootstrap useEffect.
   * 直接把 callback 列进 deps 会因 targetSessionId 等变化而触发 bootstrap 重启，
   * 进而 dispose 当前 voice session 与中断 in-flight SSE，外观就是「工具调用失败：network error」。 */
  const armDoubaoBridgeRef = useRef<() => void>(() => {});
  const enqueueVoiceTurnRef = useRef<
    (turn: {
      role: "user" | "assistant" | "tool";
      content: string;
      metadata?: Record<string, unknown>;
      tool_call_id?: string;
      tool_name?: string;
      tool_args?: Record<string, unknown>;
      tool_status?: "ok" | "error";
      tool_result_preview?: string;
    }) => void
  >(() => {});
  const scheduleDraftFlushRef = useRef<() => void>(() => {});

  const clearBridgeHintTimer = useCallback(() => {
    if (bridgeHintTimerRef.current != null) {
      window.clearTimeout(bridgeHintTimerRef.current);
      bridgeHintTimerRef.current = null;
    }
  }, []);

  const resolveBridgeAuth = useCallback(async () => {
    let base = String(apiBase ?? "").trim();
    let token = String(apiToken ?? "").trim();
    if (!base) {
      base = String((await window.agenticxDesktop.getApiBase()) || "").trim();
    }
    if (!token) {
      token = String((await window.agenticxDesktop.getApiAuthToken()) || "").trim();
    }
    return {
      apiBase: base.replace(/\/+$/, ""),
      apiToken: token,
    };
  }, [apiBase, apiToken]);

  const resolveBridgeModelHint = useCallback(async () => {
    const pane = panes.find((p) => p.id === targetPaneId);
    const paneProvider = String(pane?.modelProvider ?? "").trim();
    const paneModel = String(pane?.modelName ?? "").trim();
    if (paneProvider && paneModel) {
      return { provider: paneProvider, model: paneModel };
    }
    try {
      const cfg = await window.agenticxDesktop.loadConfig();
      const activeProvider = String(cfg.activeProvider ?? "").trim();
      const activeModel = String(cfg.activeModel ?? "").trim();
      if (activeProvider && activeModel) {
        return { provider: activeProvider, model: activeModel };
      }
      const defaultProvider = String(cfg.defaultProvider ?? "").trim();
      const defaultModel = String(cfg.providers?.[defaultProvider]?.model ?? "").trim();
      if (defaultProvider && defaultModel) {
        return { provider: defaultProvider, model: defaultModel };
      }
    } catch {
      // ignore
    }
    return { provider: "", model: "" };
  }, [panes, targetPaneId]);

  const [phase, setPhase] = useState<"idle" | "listening" | "thinking" | "speaking" | "tool_running" | "error">("idle");
  const [micLevel, setMicLevel] = useState(0);
  const [outLevel, setOutLevel] = useState(0);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [partial, setPartial] = useState<{ role: "user" | "assistant"; text: string } | null>(null);
  const partialClearTimerRef = useRef<number | null>(null);

  const [tick, setTick] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    let running = true;
    const loop = () => {
      if (!running) return;
      setTick((t) => t + 1);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      running = false;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const sessionRef = useRef<ReturnType<typeof createRealtimeVoiceSession> | null>(null);
  const meterRef = useRef({ mic: 0, out: 0 });
  const errorExitTimerRef = useRef<number | null>(null);
  const pendingVoiceTurnsRef = useRef<
    Array<{
      role: "user" | "assistant" | "tool";
      content: string;
      metadata?: Record<string, unknown>;
      tool_call_id?: string;
      tool_name?: string;
      tool_args?: Record<string, unknown>;
      tool_status?: "ok" | "error";
      tool_result_preview?: string;
    }>
  >([]);
  const appendQueueRef = useRef<Promise<void>>(Promise.resolve());
  const draftTurnsRef = useRef<Partial<Record<"user" | "assistant", string>>>({});
  const enqueuedTurnKeysRef = useRef<Set<string>>(new Set());
  const turnFlushTimerRef = useRef<number | null>(null);

  const bumpLevels = useCallback((patch: Partial<{ mic: number; out: number }>) => {
    meterRef.current = { ...meterRef.current, ...patch };
    const { mic, out } = meterRef.current;
    setMicLevel(mic);
    setOutLevel(out);
  }, []);

  const clearErrorExit = () => {
    if (errorExitTimerRef.current != null) {
      window.clearTimeout(errorExitTimerRef.current);
      errorExitTimerRef.current = null;
    }
  };

  const flushPendingVoiceTurns = useCallback(async () => {
    if (!targetSessionId) return;
    await appendQueueRef.current.catch(() => undefined);
    while (pendingVoiceTurnsRef.current.length > 0) {
      const batch = pendingVoiceTurnsRef.current.splice(0);
      try {
        await appendVoiceTurn(apiBase, apiToken, targetSessionId, batch);
      } catch (err) {
        pendingVoiceTurnsRef.current.unshift(...batch);
        throw err;
      }
    }
  }, [apiBase, apiToken, targetSessionId]);

  const enqueueVoiceTurn = useCallback(
    (turn: {
      role: "user" | "assistant" | "tool";
      content: string;
      metadata?: Record<string, unknown>;
      tool_call_id?: string;
      tool_name?: string;
      tool_args?: Record<string, unknown>;
      tool_status?: "ok" | "error";
      tool_result_preview?: string;
    }) => {
      const content = turn.content.trim();
      if (!content) return;
      const key = `${turn.role}::${content}`;
      if (enqueuedTurnKeysRef.current.has(key)) return;
      enqueuedTurnKeysRef.current.add(key);
      pendingVoiceTurnsRef.current.push({ ...turn, content });
      appendQueueRef.current = appendQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          if (!targetSessionId || pendingVoiceTurnsRef.current.length === 0) return;
          const batch = pendingVoiceTurnsRef.current.splice(0);
          await appendVoiceTurn(apiBase, apiToken, targetSessionId, batch);
        })
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.error("[voice-focus] append queue failed", err);
        });
    },
    [apiBase, apiToken, targetSessionId]
  );

  const enqueueDraftTurns = useCallback(() => {
    if (turnFlushTimerRef.current != null) {
      window.clearTimeout(turnFlushTimerRef.current);
      turnFlushTimerRef.current = null;
    }
    const drafts = draftTurnsRef.current;
    const userText = String(drafts.user ?? "").trim();
    const assistantText = String(drafts.assistant ?? "").trim();
    if (userText) enqueueVoiceTurn({ role: "user", content: userText });
    if (assistantText) enqueueVoiceTurn({ role: "assistant", content: assistantText });
  }, [enqueueVoiceTurn]);

  const scheduleDraftFlush = useCallback(() => {
    if (turnFlushTimerRef.current != null) {
      window.clearTimeout(turnFlushTimerRef.current);
    }
    turnFlushTimerRef.current = window.setTimeout(() => {
      enqueueDraftTurns();
      draftTurnsRef.current = {};
      turnFlushTimerRef.current = null;
    }, 250);
  }, [enqueueDraftTurns]);

  useEffect(() => {
    enqueueVoiceTurnRef.current = enqueueVoiceTurn;
  }, [enqueueVoiceTurn]);
  useEffect(() => {
    scheduleDraftFlushRef.current = scheduleDraftFlush;
  }, [scheduleDraftFlush]);

  const executeDoubaoMetaBridge = useCallback(
    async (userText: string) => {
      const sid = String(targetSessionIdRef.current ?? "").trim();
      const ut = userText.trim();
      // eslint-disable-next-line no-console
      console.info("[voice-focus][bridge] start", { sid, len: ut.length, preview: ut.slice(0, 80) });
      if (!sid || !ut) {
        // eslint-disable-next-line no-console
        console.warn("[voice-focus][bridge] missing sid or text, abort", { sid, hasText: !!ut });
        sessionRef.current?.resumeDoubaoOutput?.();
        setBridgeArmed(false);
        clearBridgeHintTimer();
        setBridgeHint({ text: "未检测到内容或会话", isError: true, fullText: "未检测到内容或会话" });
        bridgeHintTimerRef.current = window.setTimeout(() => {
          setBridgeHint(null);
          bridgeHintTimerRef.current = null;
        }, 3000);
        return;
      }
      const ac = new AbortController();
      bridgeAbortRef.current = ac;
      clearBridgeHintTimer();
      setBridgeHint({ text: "正在为你调用 Meta…", isError: false, fullText: "正在为你调用 Meta…" });
      setPhase("thinking");
      setPartial(null);
      const auth = await resolveBridgeAuth();
      if (!auth.apiBase) {
        setBridgeHint({
          text: "工具调用失败：后端地址为空（apiBase 未初始化）",
          isError: true,
          fullText: `工具调用失败：后端地址为空（apiBase 未初始化）\napiBase="${auth.apiBase}"`,
        });
        bridgeHintTimerRef.current = window.setTimeout(() => {
          setBridgeHint(null);
          bridgeHintTimerRef.current = null;
        }, 6000);
        setPhase("listening");
        return;
      }
      // 诊断：先打印当前 session 连了哪些 MCP / 工具数。这一步只是写日志，失败不影响后续 chat。
      try {
        const probeResp = await fetch(
          `${auth.apiBase}/api/mcp/servers?session_id=${encodeURIComponent(sid)}&reload=false`,
          { headers: { "x-agx-desktop-token": auth.apiToken }, signal: ac.signal }
        );
        if (probeResp.ok) {
          const body = (await probeResp.json()) as { servers?: Array<Record<string, unknown>> };
          const list = Array.isArray(body.servers) ? body.servers : [];
          // eslint-disable-next-line no-console
          console.info(
            "[voice-focus][bridge] mcp_status",
            list.map((s) => ({
              name: s.name,
              connected: s.connected,
              tools: s.tool_count,
              state: s.connection_state,
            }))
          );
        } else {
          // eslint-disable-next-line no-console
          console.warn("[voice-focus][bridge] mcp_status probe failed", probeResp.status);
        }
      } catch (probeErr) {
        if (!ac.signal.aborted) {
          // eslint-disable-next-line no-console
          console.warn("[voice-focus][bridge] mcp_status probe error", probeErr);
        }
      }
      const initialHint = await resolveBridgeModelHint();
      try {
        let result = await runMetaTurnViaChat({
          apiBase: auth.apiBase,
          desktopToken: auth.apiToken,
          sessionId: sid,
          query: ut,
          provider: initialHint.provider || undefined,
          model: initialHint.model || undefined,
          signal: ac.signal,
        });
        if (ac.signal.aborted) return;
        const usedHint = initialHint;
        if (!result.finalText.trim() && result.toolCalls.length === 0) {
          // No-op response with empty payload is usually not useful in voice mode.
          // Keep current result; do not auto-retry on empty success.
        }
        // When current session/model points to an unavailable distributor (e.g. deepseek-r1 route down),
        // retry once with active/default model from desktop config.
        // We only retry on known provider availability errors.
        //
        // Implementation note: this block runs from catch path below by rethrowing; here we keep the
        // happy path minimal.
        const { finalText, toolCalls } = result;
        if (ac.signal.aborted) return;
        // eslint-disable-next-line no-console
        console.info("[voice-focus][bridge] done", {
          finalLen: finalText.length,
          toolCount: toolCalls.length,
          toolNames: toolCalls.map((t) => t.name),
          provider: usedHint.provider || "<session-default>",
          model: usedHint.model || "<session-default>",
        });
        delete draftTurnsRef.current.user;
        enqueueVoiceTurn({ role: "user", content: ut });
        for (const tc of toolCalls) {
          const argsText = JSON.stringify(tc.args ?? {});
          enqueueVoiceTurn({
            role: "assistant",
            content: `[调用工具] ${tc.name}(${argsText.slice(0, 200)})`,
            metadata: {
              source: "voice-focus",
              tool_call_id: tc.callId,
              tool_name: tc.name,
              tool_args: tc.args,
            },
          });
          enqueueVoiceTurn({
            role: "tool",
            content: tc.result.slice(0, 4000),
            tool_call_id: tc.callId,
            tool_name: tc.name,
            tool_args: tc.args,
            tool_status: "ok",
            tool_result_preview: tc.result.slice(0, 240),
            metadata: { source: "voice-focus" },
          });
        }
        const reply = finalText.trim() || (toolCalls.length ? "已完成工具调用。" : "");
        if (reply) {
          enqueueVoiceTurn({ role: "assistant", content: reply });
          setPartial({ role: "assistant", text: reply });
          try {
            if (typeof window !== "undefined" && "speechSynthesis" in window) {
              window.speechSynthesis.cancel();
              const utter = new SpeechSynthesisUtterance(reply);
              utter.lang = "zh-CN";
              utter.onstart = () => setPhase("speaking");
              utter.onend = () => setPhase("listening");
              utter.onerror = () => setPhase("listening");
              window.speechSynthesis.speak(utter);
            } else {
              setPhase("listening");
            }
          } catch {
            setPhase("listening");
          }
        } else {
          setPartial(null);
          setPhase("listening");
        }
      } catch (e) {
        if (ac.signal.aborted) return;
        const errName = e instanceof Error ? e.name : "";
        if (errName === "AbortError") return;
        let err = e;
        let msg = e instanceof Error ? e.message : String(e);
        const isDistributorUnavailable = /无可用渠道|ServiceUnavailableError|missing model configuration/i.test(msg);
        if (isDistributorUnavailable) {
          try {
            const cfg = await window.agenticxDesktop.loadConfig();
            const activeProvider = String(cfg.activeProvider ?? "").trim();
            const activeModel = String(cfg.activeModel ?? "").trim();
            const defaultProvider = String(cfg.defaultProvider ?? "").trim();
            const defaultModel = String(cfg.providers?.[defaultProvider]?.model ?? "").trim();
            const fallbackHint =
              activeProvider && activeModel && (activeProvider !== initialHint.provider || activeModel !== initialHint.model)
                ? { provider: activeProvider, model: activeModel }
                : defaultProvider &&
                    defaultModel &&
                    (defaultProvider !== initialHint.provider || defaultModel !== initialHint.model)
                  ? { provider: defaultProvider, model: defaultModel }
                  : { provider: "", model: "" };
            if (fallbackHint.provider && fallbackHint.model) {
              clearBridgeHintTimer();
              setBridgeHint({
                text: "模型不可用，正在切换备用模型重试…",
                isError: false,
                fullText: `模型不可用，正在切换备用模型重试：${fallbackHint.provider}/${fallbackHint.model}`,
              });
              const retried = await runMetaTurnViaChat({
                apiBase: auth.apiBase,
                desktopToken: auth.apiToken,
                sessionId: sid,
                query: ut,
                provider: fallbackHint.provider,
                model: fallbackHint.model,
                signal: ac.signal,
              });
              if (!ac.signal.aborted) {
                // Retry succeeded: continue with normal success flow by replaying minimal state.
                delete draftTurnsRef.current.user;
                enqueueVoiceTurn({ role: "user", content: ut });
                for (const tc of retried.toolCalls) {
                  const argsText = JSON.stringify(tc.args ?? {});
                  enqueueVoiceTurn({
                    role: "assistant",
                    content: `[调用工具] ${tc.name}(${argsText.slice(0, 200)})`,
                    metadata: {
                      source: "voice-focus",
                      tool_call_id: tc.callId,
                      tool_name: tc.name,
                      tool_args: tc.args,
                    },
                  });
                  enqueueVoiceTurn({
                    role: "tool",
                    content: tc.result.slice(0, 4000),
                    tool_call_id: tc.callId,
                    tool_name: tc.name,
                    tool_args: tc.args,
                    tool_status: "ok",
                    tool_result_preview: tc.result.slice(0, 240),
                    metadata: { source: "voice-focus" },
                  });
                }
                const retryReply = retried.finalText.trim() || (retried.toolCalls.length ? "已完成工具调用。" : "");
                if (retryReply) {
                  enqueueVoiceTurn({ role: "assistant", content: retryReply });
                  setPartial({ role: "assistant", text: retryReply });
                  try {
                    if (typeof window !== "undefined" && "speechSynthesis" in window) {
                      window.speechSynthesis.cancel();
                      const utter = new SpeechSynthesisUtterance(retryReply);
                      utter.lang = "zh-CN";
                      utter.onstart = () => setPhase("speaking");
                      utter.onend = () => setPhase("listening");
                      utter.onerror = () => setPhase("listening");
                      window.speechSynthesis.speak(utter);
                    } else {
                      setPhase("listening");
                    }
                  } catch {
                    setPhase("listening");
                  }
                } else {
                  setPartial(null);
                  setPhase("listening");
                }
                return;
              }
            }
          } catch (retryErr) {
            err = retryErr;
            msg = retryErr instanceof Error ? retryErr.message : String(retryErr);
          }
        }
        const fullMsg = [
          `工具调用失败：${msg}`,
          `error_name=${err instanceof Error ? err.name : "unknown"}`,
          `apiBase=${auth.apiBase || "<empty>"}`,
          `sessionId=${sid || "<empty>"}`,
          err instanceof Error && err.stack ? `stack=${err.stack}` : "",
        ]
          .filter(Boolean)
          .join("\n");
        // eslint-disable-next-line no-console
        console.error("[voice-focus][bridge] failed", err);
        clearBridgeHintTimer();
        setPartial(null);
        setBridgeHint({
          text: `工具调用失败：${msg.slice(0, 120)}`,
          isError: true,
          fullText: fullMsg,
        });
        bridgeHintTimerRef.current = window.setTimeout(() => {
          setBridgeHint(null);
          bridgeHintTimerRef.current = null;
        }, 6000);
        setPhase("listening");
      } finally {
        if (bridgeAbortRef.current === ac) bridgeAbortRef.current = null;
        // 默认开启模式下：豆包输出保持暂停、订阅保持挂着，等下一轮 user_final。
        // 仅在用户手动 disarm 或 hangup 时才 resume + 退订。
      }
    },
    [enqueueVoiceTurn, clearBridgeHintTimer, resolveBridgeAuth]
  );

  const disarmDoubaoBridge = useCallback(() => {
    const s = sessionRef.current;
    bridgeAbortRef.current?.abort();
    bridgeAbortRef.current = null;
    unsubUserFinalRef.current?.();
    unsubUserFinalRef.current = null;
    try {
      s?.resumeDoubaoOutput?.();
    } catch {
      /* ignore */
    }
    setBridgeArmed(false);
    setBridgeHint(null);
    clearBridgeHintTimer();
    // eslint-disable-next-line no-console
    console.info("[voice-focus][bridge] disarmed");
  }, [clearBridgeHintTimer]);

  const armDoubaoBridge = useCallback(() => {
    const s = sessionRef.current;
    if (!s?.subscribeUserFinal || !s.pauseDoubaoOutput) {
      // eslint-disable-next-line no-console
      console.warn("[voice-focus][bridge] arm skipped: provider lacks bridge hooks");
      return;
    }
    if (unsubUserFinalRef.current) return; // already armed
    // eslint-disable-next-line no-console
    console.info("[voice-focus][bridge] armed (default-on)");
    s.pauseDoubaoOutput();
    setBridgeArmed(true);
    unsubUserFinalRef.current = s.subscribeUserFinal((text) => {
      if (!bridgeArmedRef.current) return;
      // eslint-disable-next-line no-console
      console.info("[voice-focus][bridge] user_final captured", {
        len: text.length,
        preview: text.slice(0, 80),
      });
      void executeDoubaoMetaBridge(text);
    });
  }, [executeDoubaoMetaBridge]);

  useEffect(() => {
    armDoubaoBridgeRef.current = armDoubaoBridge;
  }, [armDoubaoBridge]);

  const toggleDoubaoToolAsk = useCallback(() => {
    if (bridgeArmed) {
      disarmDoubaoBridge();
    } else {
      armDoubaoBridge();
    }
  }, [bridgeArmed, armDoubaoBridge, disarmDoubaoBridge]);

  const hangup = useCallback(async () => {
    clearErrorExit();
    bridgeAbortRef.current?.abort();
    bridgeAbortRef.current = null;
    unsubUserFinalRef.current?.();
    unsubUserFinalRef.current = null;
    clearBridgeHintTimer();
    try {
      sessionRef.current?.resumeDoubaoOutput?.();
    } catch {
      /* ignore */
    }
    setBridgeArmed(false);
    setBridgeHint(null);
    setErrorText(null);
    enqueueDraftTurns();
    try {
      await sessionRef.current?.dispose();
    } catch {
      /* ignore */
    }
    sessionRef.current = null;
    try {
      await flushPendingVoiceTurns();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[voice-focus] final flush failed", err);
    }
    // 主动把电话轮次回写后的 messages.json 重新读一遍并塞回目标 pane，
    // 否则普通（非委派 / 非 IM）会话不会轮询磁盘 → 用户回到聊天界面看
    // 不到刚才在电话里聊的内容，必须切换会话或重启才看得到。
    if (targetSessionId && targetPaneId) {
      try {
        const result = await window.agenticxDesktop?.loadSessionMessages?.(targetSessionId);
        // eslint-disable-next-line no-console
        console.info("[voice-focus] hangup refresh", {
          targetPaneId,
          targetSessionId,
          ok: result?.ok,
          count: Array.isArray(result?.messages) ? result.messages.length : -1,
          error: (result as { error?: string } | undefined)?.error,
        });
        if (result?.ok && Array.isArray(result.messages)) {
          const mapped = result.messages.map((item, idx) =>
            mapLoadedSessionMessage(item as LoadedSessionMessage, targetSessionId, idx)
          );
          setPaneMessages(targetPaneId, mapped);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[voice-focus] hangup refresh failed", err);
      }
    }
    exitFocusMode();
  }, [
    enqueueDraftTurns,
    exitFocusMode,
    flushPendingVoiceTurns,
    setPaneMessages,
    clearBridgeHintTimer,
    targetPaneId,
    targetSessionId,
  ]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      let resolvedSessionId = targetSessionId;
      if (!resolvedSessionId) {
        // 与文字聊天一致：空 session 时先懒创建，电话模式不应直接失败退出。
        const avatarId =
          targetAvatarId && !targetAvatarId.startsWith("group:") ? targetAvatarId : undefined;
        const created = await window.agenticxDesktop.createSession({
          ...(avatarId ? { avatar_id: avatarId } : {}),
        });
        if (!created.ok || !created.session_id) {
          setPhase("error");
          setErrorText(`未找到目标会话且创建失败：${created.error || "未知错误"}`);
          errorExitTimerRef.current = window.setTimeout(() => void hangup(), 5000);
          return;
        }
        resolvedSessionId = String(created.session_id).trim();
        setRuntimeTargetSessionId(resolvedSessionId);
        if (targetPaneId) {
          setPaneSessionId(targetPaneId, resolvedSessionId);
        }
      }
      try {
        // voice pack 与历史并行拉取：历史拉取内部捕获异常返回空数组，不阻断进入电话。
        const [pack, historyTurns] = await Promise.all([
          fetchVoicePack(apiBase, apiToken),
          fetchSessionHistory(apiBase, apiToken, resolvedSessionId, FOCUS_MODE_HISTORY_TURNS),
        ]);
        // eslint-disable-next-line no-console
        console.info("[voice-focus] bootstrap", {
          targetPaneId,
          targetSessionId: resolvedSessionId,
          historyTurns: historyTurns.length,
          flags: pack.flags,
        });
        const pv = String((pack.flags.provider || pack.voice.provider || "openai_realtime") as string).toLowerCase();
        let kind: VoiceProviderKind = pv.includes("doubao") ? "doubao_realtime" : "openai_realtime";

        const openaiReady = Boolean(pack.flags.openai_ready);
        const doubaoReady = Boolean(pack.flags.doubao_ready);

        const chooseFromFlags = (): VoiceProviderKind | null => {
          if (pv.includes("doubao") && doubaoReady) return "doubao_realtime";
          if (pv.includes("openai") && openaiReady) return "openai_realtime";
          if (doubaoReady) return "doubao_realtime";
          if (openaiReady) return "openai_realtime";
          return null;
        };
        const resolved = chooseFromFlags();
        if (!resolved) {
          setPhase("error");
          setErrorText('请先在 设置 → 语音 配置实时语音 Provider。');
          openSettings("voice");
          errorExitTimerRef.current = window.setTimeout(() => void hangup(), 5000);
          return;
        }
        kind = resolved;

        const inputDeviceId = String((pack.voice.input_device_id as string) || "").trim();
        const toolScope = readVoiceToolScope(pack.voice);

        if (!cancelled) setVoiceKind(kind);

        if (cancelled) return;

        pendingVoiceTurnsRef.current = [];
        draftTurnsRef.current = {};
        enqueuedTurnKeysRef.current = new Set();
        appendQueueRef.current = Promise.resolve();
        sessionRef.current = createRealtimeVoiceSession(kind);
        setPhase("listening");

        const onVoiceEvent = (ev: VoiceRealtimeEmit) => {
          if (cancelled) return;
          if (ev.kind === "phase") {
            const p = ev.phase === "idle" ? "listening" : ev.phase;
            setPhase(p);
          }
          if (ev.kind === "mic_level") bumpLevels({ mic: ev.value });
          if (ev.kind === "out_level") bumpLevels({ out: ev.value });
          if (ev.kind === "error") {
            setPhase("error");
            setErrorText(ev.message);
            clearErrorExit();
            errorExitTimerRef.current = window.setTimeout(() => void hangup(), 5000);
          }
          if (ev.kind === "tool_running") {
            if (ev.toolName) {
              setPartial({ role: "assistant", text: `正在调用：${ev.toolName.slice(0, 16)}` });
              setPhase("tool_running");
            } else {
              setPartial(null);
              setPhase("thinking");
            }
          }
          if (ev.kind === "tool_result") {
            const argsText = JSON.stringify(ev.toolArgs ?? {});
            enqueueVoiceTurnRef.current({
              role: "assistant",
              content: `[调用工具] ${ev.toolName}(${argsText.slice(0, 200)})`,
              metadata: {
                source: "voice-focus",
                tool_call_id: ev.callId,
                tool_name: ev.toolName,
                tool_args: ev.toolArgs ?? {},
              },
            });
            enqueueVoiceTurnRef.current({
              role: "tool",
              content: ev.output.slice(0, 4000),
              tool_call_id: ev.callId,
              tool_name: ev.toolName,
              tool_args: ev.toolArgs ?? {},
              tool_status: "ok",
              tool_result_preview: ev.output.slice(0, 240),
              metadata: {
                source: "voice-focus",
              },
            });
          }
          if (ev.kind === "user_partial" && ev.text.trim()) {
            if (partialClearTimerRef.current != null) {
              window.clearTimeout(partialClearTimerRef.current);
              partialClearTimerRef.current = null;
            }
            const text = ev.text.trim();
            draftTurnsRef.current.user = text;
            setPartial({ role: "user", text });
          }
          if (ev.kind === "assistant_partial" && ev.text.trim()) {
            if (partialClearTimerRef.current != null) {
              window.clearTimeout(partialClearTimerRef.current);
              partialClearTimerRef.current = null;
            }
            const text = ev.text.trim();
            draftTurnsRef.current.assistant = text;
            setPartial({ role: "assistant", text });
          }
          if (ev.kind === "user_final" && ev.text.trim()) {
            const text = ev.text.trim();
            draftTurnsRef.current.user = text;
            setPartial({ role: "user", text });
            // Keep on-screen until next turn starts; do NOT auto-clear.
            if (partialClearTimerRef.current != null) {
              window.clearTimeout(partialClearTimerRef.current);
              partialClearTimerRef.current = null;
            }
            // eslint-disable-next-line no-console
            console.info("[voice-focus] user_final", { len: text.length, preview: text.slice(0, 60) });
          }
          if (ev.kind === "assistant_final" && ev.text.trim()) {
            const text = ev.text.trim();
            draftTurnsRef.current.assistant = text;
            setPartial({ role: "assistant", text });
            // Keep Machi's full final text on screen until the next turn
            // begins (user_partial / assistant_partial). No auto-clear timer:
            // long answers must not vanish mid-read.
            if (partialClearTimerRef.current != null) {
              window.clearTimeout(partialClearTimerRef.current);
              partialClearTimerRef.current = null;
            }
            // eslint-disable-next-line no-console
            console.info("[voice-focus] assistant_final", {
              len: text.length,
              preview: text.slice(0, 60),
            });
            scheduleDraftFlushRef.current();
          }
        };

        await sessionRef.current.start({
          apiBase,
          desktopToken: apiToken,
          inputDeviceId: inputDeviceId ? inputDeviceId : undefined,
          voiceYaml: pack.voice,
          historyTurns,
          currentSessionId: resolvedSessionId,
          toolScope,
          emit: onVoiceEvent,
        });

        // 默认开启工具桥接：豆包用作 ASR/兜底 TTS，每轮 user_final 走 Meta 工具链。
        if (!cancelled && kind === "doubao_realtime" && sessionRef.current) {
          armDoubaoBridgeRef.current();
        }
      } catch (e) {
        if (cancelled) return;
        setPhase("error");
        const msg = e instanceof Error ? e.message : String(e);
        setErrorText(msg || "灵巧模式初始化失败（麦克风或服务端）");
        clearErrorExit();
        errorExitTimerRef.current = window.setTimeout(() => void hangup(), 5000);
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
      clearErrorExit();
      bridgeAbortRef.current?.abort();
      bridgeAbortRef.current = null;
      unsubUserFinalRef.current?.();
      unsubUserFinalRef.current = null;
      clearBridgeHintTimer();
      try {
        void sessionRef.current?.resumeDoubaoOutput?.();
      } catch {
        /* ignore */
      }
      setBridgeArmed(false);
      setBridgeHint(null);
      if (partialClearTimerRef.current != null) {
        window.clearTimeout(partialClearTimerRef.current);
        partialClearTimerRef.current = null;
      }
      if (turnFlushTimerRef.current != null) {
        window.clearTimeout(turnFlushTimerRef.current);
        turnFlushTimerRef.current = null;
      }
      void sessionRef.current?.dispose();
      sessionRef.current = null;
    };
    // NOTE: enqueueVoiceTurn / scheduleDraftFlush / armDoubaoBridge 通过 ref 调用，
    // 故意不放进 deps —— 否则 targetSessionId 一变就会触发整个 voice session 重启，
    // 中断进行中的 SSE 桥接，从而把「fetch 流被中断」的 Chromium 报错 `TypeError: network error`
    // 直接抛到用户面前。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, apiToken, targetPaneId, targetSessionId, targetAvatarId, hangup, openSettings, bumpLevels, setPaneSessionId, clearBridgeHintTimer]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key !== "Escape") return;
      e.preventDefault();
      void hangup();
    };
    window.addEventListener("keydown", esc, { capture: true });
    return () => window.removeEventListener("keydown", esc, { capture: true });
  }, [hangup]);

  const displayPhase = phase === "listening" ? "listening" : phase;
  const driveMix = phase === "speaking" ? outLevel : micLevel;

  // Perplexity-like dot grid：强弱点对比更明显（尺度 + 不透明度 + 少量光晕）。
  const COLS = 8;
  const ROWS = 3;

  return (
    <div
      className="agx-voice-focus-root drag-region"
      data-phase={displayPhase}
    >
      <div
        className="agx-voice-focus-mic-wrap no-drag"
        aria-label={voiceFocusPhaseAria(displayPhase)}
      >
        <Mic className="agx-voice-focus-mic" strokeWidth={2} aria-hidden />
      </div>

      {/* Animated dot grid waveform */}
      <div className="agx-voice-focus-dots" aria-hidden>
        {Array.from({ length: COLS }, (_, col) => (
          <div key={col} className="agx-voice-focus-dot-col">
            {Array.from({ length: ROWS }, (_, row) => {
              const t = tick / 60; // seconds at ~60fps
              const volume = Math.min(1, Math.max(driveMix, 0.08));
              const forward = Math.sin(t * 5.2 - col * 0.95 + row * 0.58) * 0.5 + 0.5;
              const counter = Math.sin(t * 3.55 + col * 0.65 + row * 1.18) * 0.5 + 0.5;
              const crest = Math.max(forward, counter * 0.68);
              const centerLift = 1 - Math.abs(row - (ROWS - 1) / 2) * 0.2;
              const energy = Math.max(0, Math.min(1, crest * centerLift));
              const opacity = Math.max(0.05, Math.min(1, 0.04 + energy * (0.22 + volume * 1.2)));
              const scale = 0.42 + energy * (0.28 + volume * 1.45);
              const glow = energy * volume > 0.52;
              return (
                <span
                  key={row}
                  className="agx-voice-focus-dot"
                  style={{
                    opacity,
                    transform: `scale(${scale})`,
                    boxShadow: glow ? "0 0 6px rgba(var(--theme-color-rgb), 0.55)" : "none",
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>

      {/* Center: marquee transcript window removed as requested. */}

      {/* Error line */}
      {errorText ? (
        <div className="agx-voice-focus-error no-drag" role="alert">
          {errorText}
        </div>
      ) : null}

      {bridgeHint && !errorText ? (
        <div
          className={`agx-voice-focus-hint no-drag${bridgeHint.isError ? " agx-voice-focus-hint--error" : ""}${bridgeHint.isError ? " agx-voice-focus-hint--clickable" : ""}`}
          role={bridgeHint.isError ? "alert" : "status"}
          title={
            bridgeHint.isError
              ? `${bridgeHint.fullText || bridgeHint.text}\n（点击复制完整错误）`
              : bridgeHint.text
          }
          onClick={
            bridgeHint.isError
              ? () => {
                  try {
                    void navigator.clipboard?.writeText(bridgeHint.fullText || bridgeHint.text);
                    setBridgeHint({ text: "错误已复制到剪贴板", isError: false });
                    clearBridgeHintTimer();
                    bridgeHintTimerRef.current = window.setTimeout(() => {
                      setBridgeHint(null);
                      bridgeHintTimerRef.current = null;
                    }, 2500);
                  } catch {
                    /* ignore */
                  }
                }
              : undefined
          }
        >
          {bridgeHint.isError ? `❌ ${bridgeHint.text.replace(/^工具调用失败：/, "")}` : bridgeHint.text}
        </div>
      ) : null}

      {/* Doubao: Meta tool bridge (工具一问) */}
      {voiceKind === "doubao_realtime" ? (
        <button
          type="button"
          className={`agx-voice-focus-tool no-drag${bridgeArmed ? " agx-voice-focus-tool--on" : " agx-voice-focus-tool--off"}`}
          aria-label={bridgeArmed ? "工具调用已开启，点击关闭（回到纯豆包对话）" : "工具调用已关闭，点击开启"}
          aria-pressed={bridgeArmed}
          title={bridgeArmed ? "工具调用：开（点击关闭）" : "工具调用：关（点击开启）"}
          onClick={() => toggleDoubaoToolAsk()}
        >
          <Wrench className="agx-voice-focus-tool-icon" strokeWidth={2} aria-hidden />
          <span className="agx-voice-focus-tool-dot" aria-hidden />
        </button>
      ) : null}

      {/* Right: stop button */}
      <button
        type="button"
        className="agx-voice-focus-stop no-drag"
        aria-label="停止并退出灵巧模式"
        onClick={() => void hangup()}
      >
        <span className="agx-voice-focus-stop-square" />
      </button>
    </div>
  );
}
