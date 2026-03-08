let currentUtterance: SpeechSynthesisUtterance | null = null;

export function speak(text: string): void {
  stopSpeak();
  currentUtterance = new SpeechSynthesisUtterance(text);
  currentUtterance.lang = "zh-CN";
  window.speechSynthesis.speak(currentUtterance);
}

export function stopSpeak(): void {
  if (window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
  }
  currentUtterance = null;
}
