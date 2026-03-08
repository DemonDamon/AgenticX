import { stopSpeak } from "./tts";

export function interruptTtsOnUserSpeech(userSpeaking: boolean): void {
  if (userSpeaking) {
    stopSpeak();
  }
}

export function interruptOnInterimResult(interimText: string): void {
  if (interimText.trim().length > 0) {
    stopSpeak();
  }
}
