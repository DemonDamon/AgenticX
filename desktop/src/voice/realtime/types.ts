/** Realtime capsule voice provider types. */

export type VoiceRingPhase = "idle" | "listening" | "thinking" | "speaking";

export type VoiceRealtimeEmit =
  | { kind: "phase"; phase: VoiceRingPhase }
  | { kind: "error"; message: string }
  | { kind: "mic_level"; value: number }
  | { kind: "out_level"; value: number }
  /** User interim ASR text (e.g. Doubao 451 ASRResponse with is_interim=true). */
  | { kind: "user_partial"; text: string }
  /** User final utterance transcription (Realtime API ASR completion). */
  | { kind: "user_final"; text: string }
  /** Assistant streaming text chunk (e.g. Doubao 550 ChatResponse content). */
  | { kind: "assistant_partial"; text: string }
  /** Assistant final paragraph (Realtime ASR/audio transcript completion). */
  | { kind: "assistant_final"; text: string };

export type VoiceConnectOptions = {
  apiBase: string;
  desktopToken: string;
  /** Preferred mic device id (empty = default). */
  inputDeviceId?: string;
  /** Effective `voice:` subtree from `/api/voice/settings` (masked secrets ok for hint fields). */
  voiceYaml?: Record<string, unknown>;
  emit: (e: VoiceRealtimeEmit) => void;
};

/** Live voice transport for the capsule (OpenAI RTC / Doubao WS, etc.). */
export interface RealtimeVoiceSession {
  start(opts: VoiceConnectOptions): Promise<void>;
  dispose(): Promise<void>;
  /** Stop model playback / current response branch. */
  interrupt(): void;
}
