import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "../store";
import type { VoiceProviderKind, VoiceRealtimeEmit } from "../voice/realtime";
import { createRealtimeVoiceSession } from "../voice/realtime";

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
  if (!resp.ok) throw new Error(`messages/append HTTP ${resp.status}`);
}

/** 圆形语音胶囊 UI + Realtime/OpenSpeech 链路（不写 plan 所述「假波形」占位，柱状条由 mic/out 音量驱动）。 */
export function VoiceFocusMode() {
  const panes = useAppStore((s) => s.panes);
  const exitFocusMode = useAppStore((s) => s.exitFocusMode);
  const openSettings = useAppStore((s) => s.openSettings);
  const apiBase = useAppStore((s) => s.apiBase);
  const apiToken = useAppStore((s) => s.apiToken);

  const metaSessionId = useMemo(
    () => String(panes.find((p) => p.id === "pane-meta")?.sessionId ?? "").trim(),
    [panes]
  );

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

  const hangup = useCallback(async () => {
    clearErrorExit();
    setErrorText(null);
    try {
      await sessionRef.current?.dispose();
    } catch {
      /* ignore */
    }
    sessionRef.current = null;
    exitFocusMode();
  }, [exitFocusMode]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      if (!metaSessionId) {
        setPhase("error");
        setErrorText("未找到元智能体会话，无法写入语音归档。");
        errorExitTimerRef.current = window.setTimeout(() => void hangup(), 5000);
        return;
      }
      try {
        const pack = await fetchVoicePack(apiBase, apiToken);
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
            setPartial({ role: "user", text: ev.text.trim() });
          }
          if (ev.kind === "assistant_partial" && ev.text.trim()) {
            if (partialClearTimerRef.current != null) {
              window.clearTimeout(partialClearTimerRef.current);
              partialClearTimerRef.current = null;
            }
            setPartial({ role: "assistant", text: ev.text.trim() });
          }
          if (ev.kind === "user_final" && ev.text.trim()) {
            const text = ev.text.trim();
            setPartial({ role: "user", text });
            // Keep on-screen until next turn starts; do NOT auto-clear.
            if (partialClearTimerRef.current != null) {
              window.clearTimeout(partialClearTimerRef.current);
              partialClearTimerRef.current = null;
            }
            void appendVoiceTurn(apiBase, apiToken, metaSessionId, [{ role: "user", content: text }]).catch(() => {});
          }
          if (ev.kind === "assistant_final" && ev.text.trim()) {
            const text = ev.text.trim();
            setPartial({ role: "assistant", text });
            // Keep Machi's full final text on screen until the next turn
            // begins (user_partial / assistant_partial). No auto-clear timer:
            // long answers must not vanish mid-read.
            if (partialClearTimerRef.current != null) {
              window.clearTimeout(partialClearTimerRef.current);
              partialClearTimerRef.current = null;
            }
            void appendVoiceTurn(apiBase, apiToken, metaSessionId, [{ role: "assistant", content: text }]).catch(
              () => {}
            );
          }
        };

        await sessionRef.current.start({
          apiBase,
          desktopToken: apiToken,
          inputDeviceId: inputDeviceId ? inputDeviceId : undefined,
          voiceYaml: pack.voice,
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
      void sessionRef.current?.dispose();
      sessionRef.current = null;
    };
  }, [apiBase, apiToken, metaSessionId, hangup, openSettings, bumpLevels]);

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
