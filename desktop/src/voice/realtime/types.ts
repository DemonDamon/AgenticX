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

/** Prior-conversation turns to inherit into the realtime session for context continuity. */
export type VoiceHistoryTurn = { role: "user" | "assistant"; content: string };

export type VoiceConnectOptions = {
  apiBase: string;
  desktopToken: string;
  /** Preferred mic device id (empty = default). */
  inputDeviceId?: string;
  /** Effective `voice:` subtree from `/api/voice/settings` (masked secrets ok for hint fields). */
  voiceYaml?: Record<string, unknown>;
  /**
   * 拨号前从触发 pane 对应 session 拉取的最近若干轮历史（已截断到 ~20 轮）。
   * 各 provider 在 start() 中按自身协议注入：OpenAI 走 DataChannel 的
   * `conversation.item.create`；Doubao 拼到 `dialog.system_role` 末尾。
   * 空数组 = 该 session 无历史（豆包/OpenAI 仍按全新对话处理）。
   */
  historyTurns?: VoiceHistoryTurn[];
  emit: (e: VoiceRealtimeEmit) => void;
};

/** Live voice transport for the capsule (OpenAI RTC / Doubao WS, etc.). */
export interface RealtimeVoiceSession {
  start(opts: VoiceConnectOptions): Promise<void>;
  dispose(): Promise<void>;
  /** Stop model playback / current response branch. */
  interrupt(): void;
}
