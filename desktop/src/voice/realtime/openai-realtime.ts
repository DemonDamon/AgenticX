import type { RealtimeVoiceSession, VoiceConnectOptions, VoiceRealtimeEmit, VoiceRingPhase } from "./types";
import { fetchToolSchemas, runToolCall } from "./tool-bridge";

function timeDomainAnalyserPeak(bins: Uint8Array): number {
  let max = 0;
  for (let i = 0; i < bins.length; i++) {
    const v = Math.abs((bins[i]! - 128) / 128);
    if (v > max) max = v;
  }
  return Math.min(1, max * 2);
}

/**
 * OpenAI Realtime over WebRTC: mic + remote audio negotiated via SDP posted to AGX backend.
 * Uses a client DataChannel (`oai-events`) for transcripts + response.cancel interruptions.
 */
export class OpenAIRealtimeRtcSession implements RealtimeVoiceSession {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private localStream: MediaStream | null = null;
  private micAnalyserCtx: AudioContext | null = null;
  private playbackEl: HTMLAudioElement | null = null;
  private outAnalyserCtx: AudioContext | null = null;
  private rafMic: number | null = null;
  private rafOut: number | null = null;

  private emit: ((e: VoiceRealtimeEmit) => void) | null = null;
  private assistantBuf = "";
  private phase: VoiceRingPhase = "idle";
  /** Track if audio is still streaming. Phase stays in "speaking" while audio
   * energy is detected, regardless of transcript completion. */
  private audioActive = false;
  private audioSilenceFrames = 0;
  /** Set true once transcript .done arrived; we then only return to listening
   * after audio playback has actually drained. */
  private transcriptDone = false;
  private currentSessionId = "";
  private apiBase = "";
  private desktopToken = "";
  private toolScope: "default" | "advanced" = "default";
  private chainDepth = 0;
  private pendingToolCalls = new Map<string, { name: string; argsJson: string }>();
  private chainLimit = 8;

  private setPhase(next: VoiceRingPhase) {
    if (this.phase === next) return;
    this.phase = next;
    this.emit?.({ kind: "phase", phase: next });
  }

  private sendDc(payload: Record<string, unknown>) {
    const ch = this.dc;
    if (!ch || ch.readyState !== "open") return;
    try {
      ch.send(JSON.stringify(payload));
    } catch {
      // ignore channel send errors
    }
  }

  private async handleFunctionCallDone(callId: string, fnName: string, argsJson: string) {
    if (!callId || !fnName || !this.currentSessionId) return;
    this.chainDepth += 1;
    this.setPhase("tool_running");
    this.emit?.({ kind: "tool_running", toolName: fnName });
    if (this.chainDepth > this.chainLimit) {
      this.sendDc({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: "Too many chained tool calls. Please answer with current evidence.",
        },
      });
      this.sendDc({ type: "response.create" });
      this.emit?.({ kind: "tool_running", toolName: null });
      return;
    }
    const result = await runToolCall({
      apiBase: this.apiBase,
      desktopToken: this.desktopToken,
      sessionId: this.currentSessionId,
      callId,
      name: fnName,
      argumentsJson: argsJson,
    });
    let parsedArgs: Record<string, unknown> = {};
    try {
      parsedArgs = (JSON.parse(argsJson || "{}") as Record<string, unknown>) ?? {};
    } catch {
      parsedArgs = {};
    }
    this.emit?.({
      kind: "tool_result",
      callId,
      toolName: fnName,
      toolArgs: parsedArgs,
      output: result.output,
    });
    this.sendDc({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: result.output.slice(0, 4000),
      },
    });
    this.sendDc({ type: "response.create" });
    this.emit?.({ kind: "tool_running", toolName: null });
    if (!result.ok) this.setPhase("thinking");
  }

  private handleDcMessage(raw: string) {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    const t = String(data.type ?? "");
    if (t === "response.function_call_arguments.delta") {
      const callId = String(data.call_id ?? "");
      const fnName = String(data.name ?? "");
      const delta = String(data.delta ?? "");
      if (callId) {
        const prev = this.pendingToolCalls.get(callId) ?? { name: fnName, argsJson: "" };
        prev.name = fnName || prev.name;
        prev.argsJson += delta;
        this.pendingToolCalls.set(callId, prev);
      }
    }
    if (t === "response.function_call_arguments.done") {
      const callId = String(data.call_id ?? "");
      const fnName = String(data.name ?? "");
      const argsJson = String(data.arguments ?? "");
      const prev = this.pendingToolCalls.get(callId);
      const finalName = fnName || prev?.name || "";
      const finalArgs = argsJson || prev?.argsJson || "{}";
      this.pendingToolCalls.delete(callId);
      void this.handleFunctionCallDone(callId, finalName, finalArgs);
      return;
    }
    if (t.includes("input_audio_buffer.speech_started")) {
      this.interrupt();
      this.setPhase("listening");
    }
    if (t === "response.created" || t === "response.in_progress") {
      this.setPhase("thinking");
      if (t === "response.created") this.chainDepth = 0;
      // New response cycle: clear any pending transcript-done flag so the
      // audio watchdog won't prematurely flip to listening on the FIRST
      // silence gap (between thinking and speaking).
      this.transcriptDone = false;
      this.audioActive = false;
      this.audioSilenceFrames = 0;
    }
    if (t.startsWith("response.output_audio") || t.startsWith("response.audio")) {
      this.setPhase("speaking");
    }
    if (t === "response.output_audio_transcript.delta" || t === "response.audio_transcript.delta") {
      // OpenAI Realtime sends delta as either string or {text}; normalize both.
      const rawDelta = data.delta as string | { text?: string } | undefined;
      const delta = typeof rawDelta === "string" ? rawDelta : rawDelta?.text;
      if (delta) {
        this.assistantBuf += delta;
        this.emit?.({ kind: "assistant_partial", text: this.assistantBuf });
      }
    }
    if (t === "response.output_audio_transcript.done" || t === "response.audio_transcript.done") {
      const text = String((data as { transcript?: string }).transcript ?? "").trim() || this.assistantBuf.trim();
      this.assistantBuf = "";
      if (text) this.emit?.({ kind: "assistant_final", text });
      // IMPORTANT: do NOT switch to listening here. OpenAI Realtime emits
      // transcript.done well before the audio finishes streaming/playing,
      // so flipping the phase now would prematurely show "收听..." while
      // Near is still speaking out loud. Let the audio-energy watchdog
      // (rafOut) flip back to "listening" once playback truly drained.
      this.transcriptDone = true;
    }
    if (t === "conversation.item.input_audio_transcription.completed") {
      const text = String((data as { transcript?: string }).transcript ?? "").trim();
      if (text) this.emit?.({ kind: "user_final", text });
    }
    if (t === "response.done" || t === "response.completed" || t === "response.canceled") {
      // Same reasoning: transcript-level "done" can fire while audio buffer
      // still has tail samples to play. Mark transcript done and let the
      // playback watchdog handle phase transition.
      this.transcriptDone = true;
      if (t === "response.canceled") this.setPhase("listening");
    }
    if (t === "error") {
      const msg = String((data.error as { message?: string } | undefined)?.message ?? data.message ?? "Realtime error");
      this.emit?.({ kind: "error", message: msg });
    }
  }

  async start(opts: VoiceConnectOptions): Promise<void> {
    this.emit = opts.emit;
    this.assistantBuf = "";
    this.currentSessionId = String(opts.currentSessionId || "");
    this.apiBase = opts.apiBase;
    this.desktopToken = opts.desktopToken;
    this.toolScope = opts.toolScope ?? "default";
    this.chainDepth = 0;
    this.pendingToolCalls.clear();
    this.setPhase("listening");

    const iceServers: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
    const pc = new RTCPeerConnection({ iceServers });
    this.pc = pc;

    const dc = pc.createDataChannel("oai-events", { ordered: true });
    this.dc = dc;
    dc.onmessage = (ev) => {
      if (typeof ev.data === "string") this.handleDcMessage(ev.data);
    };
    const initDc = async () => {
      const tools = await fetchToolSchemas({
        apiBase: this.apiBase,
        desktopToken: this.desktopToken,
        mode: this.toolScope,
      });
      this.sendDc({
        type: "session.update",
        session: {
          tool_choice: "auto",
          tools,
        },
      });
    };
    if (dc.readyState === "open") {
      void initDc();
    } else {
      dc.addEventListener("open", () => void initDc(), { once: true });
    }

    // History injection: once data channel opens, replay recent text turns so
    // realtime model can continue the same context before first spoken turn.
    const turns = (opts.historyTurns ?? []).filter((t) => t.content && t.content.trim());
    if (turns.length) {
      const sendHistory = () => {
        for (const t of turns) {
          try {
            dc.send(
              JSON.stringify({
                type: "conversation.item.create",
                item: {
                  type: "message",
                  role: t.role,
                  content: [{ type: t.role === "assistant" ? "output_text" : "input_text", text: t.content }],
                },
              })
            );
          } catch {
            // ignore — 单条注入失败不阻断后续
          }
        }
      };
      if (dc.readyState === "open") sendHistory();
      else dc.addEventListener("open", sendHistory, { once: true });
    }

    pc.ontrack = (ev) => {
      const [stream] = ev.streams;
      if (!stream) return;
      try {
        this.playbackEl = this.playbackEl ?? new Audio();
        this.playbackEl.autoplay = true;
        this.playbackEl.srcObject = stream;
        void this.playbackEl.play().catch(() => {});
      } catch {
        // ignore autoplay quirks
      }
      try {
        this.outAnalyserCtx?.close();
      } catch {
        // ignore
      }
      const octx = new AudioContext();
      this.outAnalyserCtx = octx;
      const src = octx.createMediaStreamSource(stream);
      const an = octx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const bins = new Uint8Array(an.frequencyBinCount);
      let last = 0;
      // Audio-energy watchdog: a sustained run of near-silent frames signals
      // that the assistant has truly stopped speaking (audio buffer drained).
      // Only then do we transition back to "listening", so the UI text and
      // phase stay in sync with what users actually hear.
      const SILENCE_THRESHOLD = 0.02;
      const SILENCE_FRAMES_REQUIRED = 30; // ≈ 500ms at 60fps
      const tick = () => {
        if (!this.outAnalyserCtx) return;
        an.getByteTimeDomainData(bins);
        last = timeDomainAnalyserPeak(bins);
        this.emit?.({ kind: "out_level", value: last });

        if (last > SILENCE_THRESHOLD) {
          this.audioActive = true;
          this.audioSilenceFrames = 0;
          if (this.phase !== "speaking" && this.phase !== "thinking") {
            // Audio has started; ensure we're showing speaking phase.
            this.setPhase("speaking");
          }
        } else if (this.audioActive) {
          this.audioSilenceFrames += 1;
          if (this.audioSilenceFrames >= SILENCE_FRAMES_REQUIRED) {
            // Playback truly drained. If transcript also completed, return to
            // listening. Otherwise keep current phase until transcript.done.
            this.audioActive = false;
            this.audioSilenceFrames = 0;
            if (this.transcriptDone) {
              this.transcriptDone = false;
              this.setPhase("listening");
            }
          }
        }

        this.rafOut = requestAnimationFrame(tick);
      };
      this.rafOut = requestAnimationFrame(tick);
    };

    const audioConstraints: boolean | MediaTrackConstraints =
      opts.inputDeviceId && opts.inputDeviceId !== "default"
        ? { deviceId: { exact: opts.inputDeviceId }, echoCancellation: true, noiseSuppression: true }
        : { echoCancellation: true, noiseSuppression: true };

    this.localStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
    const tr = pc.addTransceiver("audio", { direction: "sendrecv" });
    const [track] = this.localStream.getAudioTracks();
    if (track) {
      await tr.sender.replaceTrack(track);
    }

    try {
      this.micAnalyserCtx?.close();
    } catch {
      // ignore
    }
    const mctx = new AudioContext();
    this.micAnalyserCtx = mctx;
    const msrc = mctx.createMediaStreamSource(this.localStream);
    const man = mctx.createAnalyser();
    man.fftSize = 512;
    msrc.connect(man);
    const micTick = () => {
      if (!this.micAnalyserCtx) return;
      const bins = new Uint8Array(man.frequencyBinCount);
      man.getByteTimeDomainData(bins);
      const v = timeDomainAnalyserPeak(bins);
      this.emit?.({ kind: "mic_level", value: v });
      this.rafMic = requestAnimationFrame(micTick);
    };
    this.rafMic = requestAnimationFrame(micTick);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const sdp = pc.localDescription?.sdp ?? offer.sdp ?? "";
    const resp = await fetch(`${opts.apiBase.replace(/\/+$/, "")}/api/voice/realtime/openai_sdp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agx-desktop-token": opts.desktopToken,
      },
      body: JSON.stringify({ sdp }),
    });
    if (!resp.ok) {
      const detail = (await resp.text()).slice(0, 500);
      throw new Error(`OpenAI SDP 交换失败 HTTP ${resp.status}: ${detail}`);
    }
    const answerSdp = (await resp.text()).trim();
    await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
  }

  interrupt(): void {
    try {
      const ch = this.dc;
      if (ch && ch.readyState === "open") {
        ch.send(JSON.stringify({ type: "response.cancel" }));
      }
    } catch {
      // ignore
    }
    try {
      this.playbackEl?.pause();
    } catch {
      // ignore
    }
  }

  async dispose(): Promise<void> {
    if (this.rafMic != null) cancelAnimationFrame(this.rafMic);
    if (this.rafOut != null) cancelAnimationFrame(this.rafOut);
    this.rafMic = null;
    this.rafOut = null;
    try {
      this.dc?.close();
    } catch {
      // ignore
    }
    this.dc = null;
    try {
      this.pc?.getSenders().forEach((s) => s.track?.stop());
      this.pc?.close();
    } catch {
      // ignore
    }
    this.pc = null;
    try {
      this.localStream?.getTracks().forEach((t) => t.stop());
    } catch {
      // ignore
    }
    this.localStream = null;
    try {
      await this.micAnalyserCtx?.close();
    } catch {
      // ignore
    }
    this.micAnalyserCtx = null;
    try {
      await this.outAnalyserCtx?.close();
    } catch {
      // ignore
    }
    this.outAnalyserCtx = null;
    try {
      if (this.playbackEl) {
        this.playbackEl.srcObject = null;
        this.playbackEl = null;
      }
    } catch {
      // ignore
    }
    this.emit = null;
    this.assistantBuf = "";
    this.phase = "idle";
    this.audioActive = false;
    this.audioSilenceFrames = 0;
    this.transcriptDone = false;
    this.currentSessionId = "";
    this.apiBase = "";
    this.desktopToken = "";
    this.chainDepth = 0;
    this.pendingToolCalls.clear();
  }
}
