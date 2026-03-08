export type SttHandler = (text: string) => void;

export function startBrowserStt(onResult: SttHandler): (() => void) | null {
  const SpeechRecognition =
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SpeechRecognition) return null;

  const recognition = new SpeechRecognition();
  recognition.lang = "zh-CN";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onresult = (evt: any) => {
    const text = evt?.results?.[0]?.[0]?.transcript ?? "";
    if (text) onResult(text);
  };
  recognition.start();
  return () => recognition.stop();
}
