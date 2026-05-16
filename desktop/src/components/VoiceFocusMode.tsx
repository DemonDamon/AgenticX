import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "../store";
import type { VoiceProviderKind, VoiceRealtimeEmit, VoiceHistoryTurn } from "../voice/realtime";
import { createRealtimeVoiceSession } from "../voice/realtime";
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
  items: Array<{ role: "user" | "assistant"; content: string }>
): Promise<void> {
  if (!items.length) return;
  const base = apiBase.replace(/\/+$/, "");
  const md = { source: "voice-focus" };
  const wrapped = items.map((r) => ({ ...r, metadata: md }));
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
export function VoiceFocusMode() {
  const panes = useAppStore((s) => s.panes);
  const focusModePaneId = useAppStore((s) => s.focusModePaneId);
  const exitFocusMode = useAppStore((s) => s.exitFocusMode);
  const openSettings = useAppStore((s) => s.openSettings);
  const apiBase = useAppStore((s) => s.apiBase);
  const apiToken = useAppStore((s) => s.apiToken);
  const setPaneMessages = useAppStore((s) => s.setPaneMessages);

  /**
   * 解析「目标会话」：
   *   - 优先用 store.focusModePaneId（由触发的 ChatPane 拨号按钮 / 快捷键写入）；
   *   - 找不到时回落到 pane-meta，避免历史会话丢失。
   * 该 sessionId 同时作为：(a) 历史拉取入参，(b) user_final / assistant_final 写回目标，
   * targetPaneId 则用于挂断后向该 pane 主动 push 一次磁盘消息刷新。
   */
  const { targetPaneId, targetSessionId } = useMemo(() => {
    const targetPane =
      panes.find((p) => p.id === focusModePaneId) ?? panes.find((p) => p.id === "pane-meta");
    return {
      targetPaneId: targetPane?.id ?? "pane-meta",
      targetSessionId: String(targetPane?.sessionId ?? "").trim(),
    };
  }, [panes, focusModePaneId]);

  const [phase, setPhase] = useState<"idle" | "listening" | "thinking" | "speaking" | "error">("idle");
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
  const pendingVoiceTurnsRef = useRef<Array<{ role: "user" | "assistant"; content: string }>>([]);
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
    (turn: { role: "user" | "assistant"; content: string }) => {
      const content = turn.content.trim();
      if (!content) return;
      const key = `${turn.role}::${content}`;
      if (enqueuedTurnKeysRef.current.has(key)) return;
      enqueuedTurnKeysRef.current.add(key);
      pendingVoiceTurnsRef.current.push({ role: turn.role, content });
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

  const hangup = useCallback(async () => {
    clearErrorExit();
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
  }, [enqueueDraftTurns, exitFocusMode, flushPendingVoiceTurns, setPaneMessages, targetPaneId, targetSessionId]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      if (!targetSessionId) {
        setPhase("error");
        setErrorText("未找到目标会话，无法写入语音归档。");
        errorExitTimerRef.current = window.setTimeout(() => void hangup(), 5000);
        return;
      }
      try {
        // voice pack 与历史并行拉取：历史拉取内部捕获异常返回空数组，不阻断进入电话。
        const [pack, historyTurns] = await Promise.all([
          fetchVoicePack(apiBase, apiToken),
          fetchSessionHistory(apiBase, apiToken, targetSessionId, FOCUS_MODE_HISTORY_TURNS),
        ]);
        // eslint-disable-next-line no-console
        console.info("[voice-focus] bootstrap", {
          targetPaneId,
          targetSessionId,
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
            scheduleDraftFlush();
          }
        };

        await sessionRef.current.start({
          apiBase,
          desktopToken: apiToken,
          inputDeviceId: inputDeviceId ? inputDeviceId : undefined,
          voiceYaml: pack.voice,
          historyTurns,
          emit: onVoiceEvent,
        });
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
  }, [apiBase, apiToken, targetPaneId, targetSessionId, hangup, openSettings, bumpLevels, enqueueVoiceTurn, scheduleDraftFlush]);

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

  // Wide Perplexity-like dot grid. Text is intentionally hidden in focus mode;
  // the voice state is expressed through the waveform.
  const COLS = 11;
  const ROWS = 3;

  return (
    <div
      className="agx-voice-focus-root drag-region"
      data-phase={displayPhase}
    >
      {/* Animated dot grid waveform */}
      <div className="agx-voice-focus-dots" aria-hidden>
        {Array.from({ length: COLS }, (_, col) => (
          <div key={col} className="agx-voice-focus-dot-col">
            {Array.from({ length: ROWS }, (_, row) => {
              const t = tick / 60; // seconds at ~60fps
              const volume = Math.min(1, Math.max(driveMix, 0.12));
              // Perplexity-like travelling wave: several bright peaks move
              // across a wider grid, with row offsets so it feels organic.
              const forward = Math.sin(t * 5.0 - col * 0.92 + row * 0.55) * 0.5 + 0.5;
              const counter = Math.sin(t * 3.4 + col * 0.62 + row * 1.15) * 0.5 + 0.5;
              const crest = Math.max(forward, counter * 0.72);
              const centerLift = 1 - Math.abs(row - (ROWS - 1) / 2) * 0.16;
              const energy = Math.max(0, Math.min(1, crest * centerLift));
              const opacity = Math.max(0.12, Math.min(1, 0.1 + energy * (0.35 + volume * 0.68)));
              const scale = 0.72 + energy * (0.18 + volume * 0.95);
              return (
                <span
                  key={row}
                  className="agx-voice-focus-dot"
                  style={{ opacity, transform: `scale(${scale})` }}
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
