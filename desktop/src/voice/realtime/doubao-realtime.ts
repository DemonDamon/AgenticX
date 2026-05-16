import {
  DOUBAO_MSG_TYPE,
  DOUBAO_SERVER_EVENT,
  decodeServerFrame,
  encodeAudioTask,
  encodeFinishConnection,
  encodeFinishSession,
  encodeStartConnection,
  encodeStartSession,
} from "./doubao-wire";
import type { RealtimeVoiceSession, VoiceConnectOptions, VoiceRealtimeEmit, VoiceRingPhase } from "./types";

function httpToWs(apiBase: string): string {
  const u = apiBase.replace(/\/+$/, "");
  if (u.startsWith("https://")) return `wss://${u.slice("https://".length)}`;
  if (u.startsWith("http://")) return `ws://${u.slice("http://".length)}`;
  return u;
}

function floatFrameToTargetPcm16(src: Float32Array, srcRate: number, targetRate: number): Uint8Array {
  if (!src.byteLength || targetRate <= 0 || srcRate <= 0) return new Uint8Array();
  const outSamples = Math.max(1, Math.floor((src.length * targetRate) / srcRate));
  const out = new DataView(new ArrayBuffer(outSamples * 2));
  let o = 0;
  while (o < outSamples) {
    const t = (o * srcRate) / targetRate;
    const i = Math.min(src.length - 1, Math.floor(t));
    const s = Math.max(-1, Math.min(1, src[i]!));
    out.setInt16(o * 2, Math.round(s * 32767), true);
    o += 1;
  }
  return new Uint8Array(out.buffer);
}

function pcm16PeakLe(buf: Uint8Array): number {
  if (!buf.byteLength || buf.byteLength % 2) return 0;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let m = 0;
  for (let i = 0; i < dv.byteLength; i += 2) {
    m = Math.max(m, Math.abs(dv.getInt16(i, true)));
  }
  return m / 32768;
}

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    try {
      return (crypto as Crypto).randomUUID();
    } catch {
      // fall through
    }
  }
  // RFC4122-ish fallback
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Doubao 端到端实时语音对话 (V3 `/api/v3/realtime/dialogue`).
 *
 * Bridge: 浏览器无法注入 `X-Api-*` headers，统一走 AGX 服务端 `/ws/voice/doubao` 透传。
 *
 * 协议要点（详见 docs/thrdparty/端到端实时语音大模型API接入文档.md）：
 *   1. 客户端帧 type-flags=0b0100，必须携带 event id；Session 级事件必须带 session_id。
 *   2. 客户端音频 PCM 16k mono int16 LE；服务端默认 OGG-Opus，本实现强制 PCM s16le 24k 输出。
 *   3. 必传字段：`dialog.extra.model`（O2.0=`1.2.1.1`，SC2.0=`2.2.0.0`），`asr.extra` / `tts.extra` 不能为 null。
 *   4. 关闭顺序：FinishSession (102) → 等待 SessionFinished → FinishConnection (2) → close ws。
 *   5. server_vad 模式下无需 ClientInterrupt；本实现 interrupt() 仅本地丢弃缓冲并提示听音状态。
 */
export class DoubaoOpenspeechRealtimeSession implements RealtimeVoiceSession {
  private ws: WebSocket | null = null;
  private localStream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private proc: ScriptProcessorNode | null = null;
  private playCtx: AudioContext | null = null;
  private playHead = 0;
  private queuedNodes: AudioBufferSourceNode[] = [];

  private emit: ((e: VoiceRealtimeEmit) => void) | null = null;
  private outMeter = 0;
  private rafMeter: number | null = null;
  private userTextBuf = "";
  private lastUserFinal = "";
  private assistantTextBuf = "";
  private lastAssistantFinal = "";

  private readonly micRate = 16000;
  private readonly outRate = 24000;
  private sessionId = uuid();
  private sessionStarted = false;
  private connectionStarted = false;

  private bumpOutMeter(pcm: Uint8Array) {
    const p = pcm16PeakLe(pcm);
    if (p > this.outMeter) this.outMeter = p;
    this.emit?.({ kind: "out_level", value: this.outMeter });
  }

  private setPhase(next: VoiceRingPhase) {
    this.emit?.({ kind: "phase", phase: next });
  }

  private mergeUserText(next: string) {
    const text = next.trim();
    if (!text) return;
    const prev = this.userTextBuf.trim();
    if (!prev) {
      this.userTextBuf = text;
    } else if (prev === text || prev.endsWith(text)) {
      this.userTextBuf = prev;
    } else if (text.startsWith(prev)) {
      this.userTextBuf = text;
    } else {
      this.userTextBuf = `${prev}${text}`;
    }
    this.emit?.({ kind: "user_partial", text: this.userTextBuf });
  }

  private emitUserFinal() {
    const text = this.userTextBuf.trim();
    if (!text || text === this.lastUserFinal) return;
    this.lastUserFinal = text;
    this.emit?.({ kind: "user_final", text });
  }

  private mergeAssistantText(next: string) {
    const text = next.trim();
    if (!text) return;
    const prev = this.assistantTextBuf.trim();
    if (!prev) {
      this.assistantTextBuf = text;
    } else if (prev === text || prev.endsWith(text)) {
      this.assistantTextBuf = prev;
    } else if (text.startsWith(prev)) {
      this.assistantTextBuf = text;
    } else {
      this.assistantTextBuf = `${prev}${text}`;
    }
    this.emit?.({ kind: "assistant_partial", text: this.assistantTextBuf });
  }

  private emitAssistantFinal() {
    const text = this.assistantTextBuf.trim();
    if (!text || text === this.lastAssistantFinal) return;
    this.lastAssistantFinal = text;
    this.emit?.({ kind: "assistant_final", text });
  }

  private startMeterDecay() {
    const tick = () => {
      this.outMeter *= 0.92;
      this.emit?.({ kind: "out_level", value: this.outMeter });
      this.rafMeter = requestAnimationFrame(tick);
    };
    this.rafMeter = requestAnimationFrame(tick);
  }

  private enqueuePcmOut(pcm: Uint8Array) {
    try {
      if (!pcm.byteLength || pcm.byteLength % 2) return;
      if (!this.playCtx || this.playCtx.state === "closed") {
        this.playCtx = new AudioContext();
        this.playHead = this.playCtx.currentTime + 0.05;
      }
      const ctx = this.playCtx;
      const n = pcm.byteLength / 2;
      const dv = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
      const f32 = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        f32[i] = dv.getInt16(i * 2, true) / 32768;
      }
      const buf = ctx.createBuffer(1, n, this.outRate);
      buf.copyToChannel(f32, 0, 0);
      const node = ctx.createBufferSource();
      node.buffer = buf;
      node.connect(ctx.destination);
      const startAt = Math.max(ctx.currentTime, this.playHead);
      node.start(startAt);
      this.playHead = startAt + buf.duration;
      this.bumpOutMeter(pcm);
      this.queuedNodes.push(node);
      node.onended = () => {
        this.queuedNodes = this.queuedNodes.filter((x) => x !== node);
      };
      this.setPhase("speaking");
    } catch {
      // ignore playback glitches
    }
  }

  private flushPlayback() {
    for (const n of this.queuedNodes) {
      try {
        n.stop();
      } catch {
        // ignore
      }
    }
    this.queuedNodes = [];
    try {
      this.playCtx?.close();
    } catch {
      // ignore
    }
    this.playCtx = null;
    this.playHead = 0;
    this.outMeter = 0;
  }

  private buildStartSessionPayload(opts: VoiceConnectOptions): Record<string, unknown> {
    const db =
      (opts.voiceYaml?.doubao_realtime as Record<string, unknown> | undefined) ?? {};
    const speaker = String(db.voice_type || db.speaker || "zh_female_vv_jupiter_bigtts").trim();
    const model = String(db.model || "1.2.1.1").trim() || "1.2.1.1";
    const botName = String(db.bot_name || "Machi").trim();
    const baseSystemRole = typeof db.system_role === "string" ? (db.system_role as string) : "";
    const speakingStyle = typeof db.speaking_style === "string" ? (db.speaking_style as string) : "";
    const inputMod = String(db.input_mod || "").trim(); // 留空走默认麦克风模式

    // 豆包实时语音协议未暴露独立的「历史消息」字段，只能把上下文拼到
    // `dialog.system_role`：把最近 N 轮对话作为参考资料告知模型，
    // 使其在电话里能延续之前的话题。注入文本若过长会增加首响时延，
    // 上游已在 VoiceFocusMode 截断到 ~20 轮。
    const turns = (opts.historyTurns ?? []).filter((t) => t.content && t.content.trim());
    let systemRole = baseSystemRole;
    if (turns.length) {
      const lines = turns.map((t) => `${t.role === "user" ? "用户" : "Machi"}：${t.content.trim()}`);
      const block = `\n\n## 此前对话上下文（仅供参考，电话里可自然延续）\n${lines.join("\n")}`;
      systemRole = (baseSystemRole + block).trim();
    }

    const dialogExtra: Record<string, unknown> = {
      strict_audit: false,
      model,
    };
    if (inputMod) dialogExtra.input_mod = inputMod;

    return {
      tts: {
        speaker,
        audio_config: {
          channel: 1,
          format: "pcm_s16le",
          sample_rate: this.outRate,
        },
        extra: {},
      },
      asr: {
        audio_info: {
          format: "pcm",
          sample_rate: this.micRate,
          channel: 1,
        },
        extra: {},
      },
      dialog: {
        bot_name: botName || "Machi",
        ...(systemRole ? { system_role: systemRole } : {}),
        ...(speakingStyle ? { speaking_style: speakingStyle } : {}),
        extra: dialogExtra,
      },
    };
  }

  async start(opts: VoiceConnectOptions): Promise<void> {
    this.emit = opts.emit;
    this.outMeter = 0;
    this.sessionId = uuid();
    this.sessionStarted = false;
    this.connectionStarted = false;
    this.userTextBuf = "";
    this.lastUserFinal = "";
    this.assistantTextBuf = "";
    this.lastAssistantFinal = "";

    const baseWs = `${httpToWs(opts.apiBase)}/ws/voice/doubao?x_agx_desktop_token=${encodeURIComponent(opts.desktopToken)}`;

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(baseWs);
      ws.binaryType = "arraybuffer";
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("Doubao websocket 连接失败"));
    });

    // 1) StartConnection
    this.ws?.send(encodeStartConnection());

    // 2) StartSession（payload 必含 model + 非空 asr.extra/tts.extra）
    const startPayload = this.buildStartSessionPayload(opts);
    this.ws?.send(encodeStartSession(this.sessionId, startPayload));

    this.setPhase("listening");
    this.startMeterDecay();

    const audioConstraints: boolean | MediaTrackConstraints =
      opts.inputDeviceId && opts.inputDeviceId !== "default"
        ? { deviceId: { exact: opts.inputDeviceId }, echoCancellation: true, noiseSuppression: true }
        : { echoCancellation: true, noiseSuppression: true };

    this.localStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
    this.audioCtx = new AudioContext();
    const sr = this.audioCtx.sampleRate;
    const src = this.audioCtx.createMediaStreamSource(this.localStream);

    const proc = this.audioCtx.createScriptProcessor(4096, 1, 1);
    this.proc = proc;

    proc.onaudioprocess = (event) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const ib = event.inputBuffer.getChannelData(0);
      const pcmDown = floatFrameToTargetPcm16(ib, sr, this.micRate);
      if (!pcmDown.byteLength) return;
      try {
        this.ws.send(encodeAudioTask(this.sessionId, pcmDown));
      } catch {
        // ignore websocket backpressure failures
      }
      this.emit?.({ kind: "mic_level", value: pcm16PeakLe(pcmDown) });
    };

    const silence = this.audioCtx.createGain();
    silence.gain.value = 0;
    src.connect(proc);
    proc.connect(silence);
    silence.connect(this.audioCtx.destination);

    const wsRx = this.ws;
    wsRx!.onmessage = (ev: MessageEvent) => {
      if (!(ev.data instanceof ArrayBuffer)) {
        // 服务端只走二进制；防御性忽略文本帧
        return;
      }
      const frame = decodeServerFrame(new Uint8Array(ev.data));
      if (!frame) return;

      // 错误帧
      if (frame.messageType === DOUBAO_MSG_TYPE.ERROR_INFO) {
        const err = frame.jsonPayload?.error || `error_code=${frame.errorCode ?? "?"}`;
        this.emit?.({ kind: "error", message: `豆包错误: ${String(err)}` });
        return;
      }

      const event = frame.event ?? -1;
      switch (event) {
        case DOUBAO_SERVER_EVENT.ConnectionStarted:
          this.connectionStarted = true;
          break;
        case DOUBAO_SERVER_EVENT.ConnectionFailed:
          this.emit?.({ kind: "error", message: `豆包连接失败: ${String(frame.jsonPayload?.error ?? "")}` });
          break;
        case DOUBAO_SERVER_EVENT.SessionStarted:
          this.sessionStarted = true;
          this.setPhase("listening");
          break;
        case DOUBAO_SERVER_EVENT.SessionFailed:
          this.emit?.({ kind: "error", message: `豆包会话失败: ${String(frame.jsonPayload?.error ?? "")}` });
          break;
        case DOUBAO_SERVER_EVENT.ASRInfo:
          // 用户开口；本地立即停掉模型播报，避免抢话
          this.flushPlayback();
          this.userTextBuf = "";
          this.setPhase("listening");
          break;
        case DOUBAO_SERVER_EVENT.ASRResponse: {
          const payload = frame.jsonPayload ?? {};
          const results =
            (payload.results as Array<{ text?: string; content?: string; is_interim?: boolean | string }> | undefined) ??
            [];
          const topLevelText = String(payload.text ?? payload.content ?? "").trim();
          if (topLevelText && results.length === 0) {
            this.mergeUserText(topLevelText);
          }
          for (const r of results) {
            const t = String(r.text ?? r.content ?? "").trim();
            if (!t) continue;
            this.mergeUserText(t);
            const interim = r.is_interim === true || String(r.is_interim).toLowerCase() === "true";
            if (!interim) this.emitUserFinal();
          }
          break;
        }
        case DOUBAO_SERVER_EVENT.ASREnded:
          this.emitUserFinal();
          this.assistantTextBuf = "";
          this.setPhase("thinking");
          break;
        case DOUBAO_SERVER_EVENT.ChatResponse: {
          const t = String(frame.jsonPayload?.content ?? "").trim();
          if (t) this.mergeAssistantText(t);
          break;
        }
        case DOUBAO_SERVER_EVENT.ChatEnded: {
          this.emitAssistantFinal();
          break;
        }
        case DOUBAO_SERVER_EVENT.TTSSentenceStart: {
          const t = String(frame.jsonPayload?.text ?? "").trim();
          // This is a TTS sentence boundary, not the whole model answer.
          // Treat it as a fallback partial only; final is emitted on ChatEnded
          // (or TTSEnded if ChatEnded was not observed).
          if (t) this.mergeAssistantText(t);
          this.setPhase("speaking");
          break;
        }
        case DOUBAO_SERVER_EVENT.TTSResponse: {
          if (frame.binaryPayload && frame.binaryPayload.byteLength) {
            this.enqueuePcmOut(frame.binaryPayload);
          }
          break;
        }
        case DOUBAO_SERVER_EVENT.TTSEnded:
          this.emitAssistantFinal();
          this.setPhase("listening");
          break;
        case DOUBAO_SERVER_EVENT.DialogCommonError: {
          const code = String(frame.jsonPayload?.status_code ?? "");
          const msg = String(frame.jsonPayload?.message ?? "");
          this.emit?.({ kind: "error", message: `豆包对话错误[${code}]: ${msg}` });
          break;
        }
        default:
          // ignore other server events for now
          break;
      }
    };
  }

  interrupt(): void {
    // server_vad 模式下豆包会自动检测打断；这里只清本地缓冲，避免按钮点击时还在播旧音
    this.flushPlayback();
    this.setPhase("listening");
  }

  async dispose(): Promise<void> {
    if (this.rafMeter != null) cancelAnimationFrame(this.rafMeter);
    this.rafMeter = null;
    this.flushPlayback();

    // 优雅关闭：FinishSession → FinishConnection → close
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        if (this.sessionStarted) {
          try {
            this.ws.send(encodeFinishSession(this.sessionId));
          } catch {
            // ignore
          }
        }
        if (this.connectionStarted) {
          try {
            this.ws.send(encodeFinishConnection());
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }

    try {
      this.proc?.disconnect();
    } catch {
      // ignore
    }
    this.proc = null;
    try {
      await this.audioCtx?.close();
    } catch {
      // ignore
    }
    this.audioCtx = null;
    try {
      this.localStream?.getTracks().forEach((t) => t.stop());
    } catch {
      // ignore
    }
    this.localStream = null;
    try {
      this.ws?.close();
    } catch {
      // ignore
    }
    this.ws = null;
    this.emit = null;
    this.userTextBuf = "";
    this.lastUserFinal = "";
    this.assistantTextBuf = "";
    this.lastAssistantFinal = "";
  }
}
