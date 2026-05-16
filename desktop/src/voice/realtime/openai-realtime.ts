import type { RealtimeVoiceSession, VoiceConnectOptions, VoiceRealtimeEmit, VoiceRingPhase } from "./types";

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

  private setPhase(next: VoiceRingPhase) {
    if (this.phase === next) return;
    this.phase = next;
    this.emit?.({ kind: "phase", phase: next });
  }

  private handleDcMessage(raw: string) {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    const t = String(data.type ?? "");
    if (t.includes("input_audio_buffer.speech_started")) {
      this.interrupt();
      this.setPhase("listening");
    }
    if (t === "response.created" || t === "response.in_progress") {
      this.setPhase("thinking");
    }
    if (t.startsWith("response.output_audio") || t.startsWith("response.audio")) {
      this.setPhase("speaking");
    }
    if (t === "response.output_audio_transcript.delta" || t === "response.audio_transcript.delta") {
      const delta = (data.delta as { text?: string } | undefined)?.text;
      if (delta) this.assistantBuf += delta;
    }
    if (t === "response.output_audio_transcript.done" || t === "response.audio_transcript.done") {
      const text = String((data as { transcript?: string }).transcript ?? "").trim() || this.assistantBuf.trim();
      this.assistantBuf = "";
      if (text) this.emit?.({ kind: "assistant_final", text });
      this.setPhase("listening");
    }
    if (t === "conversation.item.input_audio_transcription.completed") {
      const text = String((data as { transcript?: string }).transcript ?? "").trim();
      if (text) this.emit?.({ kind: "user_final", text });
    }
    if (t === "response.done" || t === "response.completed" || t === "response.canceled") {
      this.setPhase("listening");
    }
    if (t === "error") {
      const msg = String((data.error as { message?: string } | undefined)?.message ?? data.message ?? "Realtime error");
      this.emit?.({ kind: "error", message: msg });
    }
  }

  async start(opts: VoiceConnectOptions): Promise<void> {
    this.emit = opts.emit;
    this.assistantBuf = "";
    this.setPhase("listening");

    const iceServers: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
    const pc = new RTCPeerConnection({ iceServers });
    this.pc = pc;

    const dc = pc.createDataChannel("oai-events", { ordered: true });
    this.dc = dc;
    dc.onmessage = (ev) => {
      if (typeof ev.data === "string") this.handleDcMessage(ev.data);
    };

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
      const tick = () => {
        if (!this.outAnalyserCtx) return;
        an.getByteTimeDomainData(bins);
        last = timeDomainAnalyserPeak(bins);
        this.emit?.({ kind: "out_level", value: last });
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
  }
}
