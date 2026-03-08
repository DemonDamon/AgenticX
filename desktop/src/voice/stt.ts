export type SttHandler = (text: string) => void;
export type SttInterimHandler = (text: string) => void;

let mediaRecorder: MediaRecorder | null = null;
let chunks: Blob[] = [];
let stopBrowserFallback: (() => void) | null = null;
let recordGeneration = 0;

async function tryWhisperTranscribe(audioBlob: Blob): Promise<string> {
  try {
    const whisper = await import("whisper-wasm");
    const arrayBuffer = await audioBlob.arrayBuffer();
    if (typeof (whisper as any).transcribe === "function") {
      const result = await (whisper as any).transcribe(new Uint8Array(arrayBuffer));
      return String(result?.text ?? "").trim();
    }
    return "";
  } catch {
    return "";
  }
}

export function startBrowserFallback(
  onResult: SttHandler,
  onInterim?: SttInterimHandler
): (() => void) | null {
  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SpeechRecognition) return null;
  const recognition = new SpeechRecognition();
  recognition.lang = "zh-CN";
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.onresult = (evt: any) => {
    const result = evt?.results?.[evt.results.length - 1];
    const transcript = result?.[0]?.transcript ?? "";
    if (!transcript) return;
    if (result?.isFinal) {
      onResult(transcript);
    } else {
      onInterim?.(transcript);
    }
  };
  recognition.start();
  return () => recognition.stop();
}

export async function startRecording(
  onResult: SttHandler,
  onInterim?: SttInterimHandler
): Promise<() => void> {
  stopRecording();
  recordGeneration += 1;
  const generation = recordGeneration;
  chunks = [];
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (evt) => {
      if (evt.data.size > 0) chunks.push(evt.data);
    };
    mediaRecorder.onstop = async () => {
      if (generation !== recordGeneration) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const audioBlob = new Blob(chunks, { type: "audio/webm" });
      const text = await tryWhisperTranscribe(audioBlob);
      if (generation !== recordGeneration) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      if (text) {
        onResult(text);
      } else {
        stopBrowserFallback = startBrowserFallback(onResult, onInterim);
      }
      stream.getTracks().forEach((track) => track.stop());
    };
    mediaRecorder.start();
    return () => stopRecording();
  } catch {
    stopBrowserFallback = startBrowserFallback(onResult, onInterim);
    return () => stopRecording();
  }
}

export function stopRecording(): void {
  recordGeneration += 1;
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
  mediaRecorder = null;
  if (stopBrowserFallback) {
    stopBrowserFallback();
    stopBrowserFallback = null;
  }
}
