import type { RealtimeVoiceSession } from "./types";
import { OpenAIRealtimeRtcSession } from "./openai-realtime";
import { DoubaoOpenspeechRealtimeSession } from "./doubao-realtime";

export type VoiceProviderKind = "openai_realtime" | "doubao_realtime";

export function createRealtimeVoiceSession(provider: VoiceProviderKind): RealtimeVoiceSession {
  if (provider === "doubao_realtime") return new DoubaoOpenspeechRealtimeSession();
  return new OpenAIRealtimeRtcSession();
}

export type {
  VoiceConnectOptions,
  VoiceRealtimeEmit,
  VoiceRingPhase,
  VoiceHistoryTurn,
  RealtimeVoiceSession,
} from "./types";
