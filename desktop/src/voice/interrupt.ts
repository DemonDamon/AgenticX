import { stopSpeak } from "./tts";

export function interruptTtsOnUserSpeech(userSpeaking: boolean): void {
  if (userSpeaking) {
    stopSpeak();
  }
}
