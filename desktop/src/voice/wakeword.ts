export function detectWakeword(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return normalized.includes("hey jarvis") || normalized.includes("嘿 jarvis") || normalized.includes("嘿jarvis");
}

export function stripWakeword(text: string): string {
  return text
    .replace(/hey\s*jarvis/gi, "")
    .replace(/嘿\s*jarvis/gi, "")
    .trim();
}

export function watchWakewordLoop(onWake: (remainingText: string) => void): void {
  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SpeechRecognition) return;
  const recognition = new SpeechRecognition();
  recognition.lang = "zh-CN";
  recognition.interimResults = true;
  recognition.continuous = true;
  recognition.onresult = (evt: any) => {
    const result = evt?.results?.[evt.results.length - 1];
    const text = result?.[0]?.transcript ?? "";
    if (!text) return;
    if (detectWakeword(text)) {
      onWake(stripWakeword(text));
    }
  };
  recognition.onend = () => recognition.start();
  recognition.start();
}
