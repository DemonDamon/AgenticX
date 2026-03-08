let currentUtterance: SpeechSynthesisUtterance | null = null;

export async function speak(text: string): Promise<void> {
  if (!text.trim()) return;
  stopSpeak();
  try {
    const platform = await window.agenticxDesktop.platform();
    if (platform === "darwin") {
      const native = await window.agenticxDesktop.nativeSay(text);
      if (native?.ok) return;
    }
  } catch {
    // fallback below
  }
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
