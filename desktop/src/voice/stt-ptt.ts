export type PushToTalkStreamCallbacks = {
  onInterim: (text: string) => void;
  onError?: (message: string) => void;
};

export type PushToTalkStreamSession = {
  stop: () => Promise<string>;
  cancel: () => void;
};

export type PushToTalkStreamOptions = {
  apiBase?: string;
  apiToken?: string;
  inputDeviceId?: string;
  language?: string;
};

function joinTranscript(finals: string[], interim: string): string {
  const parts = [...finals.map((part) => part.trim()).filter(Boolean)];
  const tail = interim.trim();
  if (tail) parts.push(tail);
  return parts.join(" ").trim();
}

export function startBrowserPushToTalkStream(
  callbacks: PushToTalkStreamCallbacks
): PushToTalkStreamSession | null {
  const SpeechRecognition =
    (window as unknown as { SpeechRecognition?: new () => SpeechRecognition }).SpeechRecognition ||
    (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognition }).webkitSpeechRecognition;
  if (!SpeechRecognition) {
    callbacks.onError?.("当前环境不支持流式语音识别");
    return null;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = "zh-CN";
  recognition.interimResults = true;
  recognition.continuous = true;
  recognition.maxAlternatives = 1;

  const finals: string[] = [];
  let latestInterim = "";
  let stopped = false;
  let resolveStop: ((text: string) => void) | null = null;
  let rejectStop: ((error: Error) => void) | null = null;

  recognition.onresult = (evt: SpeechRecognitionEvent) => {
    let interim = "";
    for (let i = evt.resultIndex; i < evt.results.length; i += 1) {
      const result = evt.results[i];
      const transcript = result?.[0]?.transcript ?? "";
      if (!transcript) continue;
      if (result.isFinal) {
        finals.push(transcript);
        latestInterim = "";
      } else {
        interim += transcript;
      }
    }
    if (interim) latestInterim = interim;
    callbacks.onInterim(joinTranscript(finals, latestInterim));
  };

  recognition.onerror = () => {
    if (stopped) return;
    callbacks.onError?.("流式语音识别失败，请检查麦克风权限");
    rejectStop?.(new Error("speech recognition error"));
    resolveStop = null;
    rejectStop = null;
  };

  recognition.onend = () => {
    if (!resolveStop) return;
    const text = joinTranscript(finals, latestInterim);
    resolveStop(text);
    resolveStop = null;
    rejectStop = null;
  };

  try {
    recognition.start();
  } catch {
    callbacks.onError?.("无法启动流式语音识别");
    return null;
  }

  return {
    stop: () =>
      new Promise<string>((resolve, reject) => {
        if (stopped) {
          resolve(joinTranscript(finals, latestInterim));
          return;
        }
        stopped = true;
        resolveStop = resolve;
        rejectStop = reject;
        try {
          recognition.stop();
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
        window.setTimeout(() => {
          if (!resolveStop) return;
          const text = joinTranscript(finals, latestInterim);
          resolveStop(text);
          resolveStop = null;
          rejectStop = null;
        }, 1500);
      }),
    cancel: () => {
      stopped = true;
      resolveStop = null;
      rejectStop = null;
      try {
        recognition.abort();
      } catch {
        /* ignore */
      }
    },
  };
}

export async function startPushToTalkStream(
  callbacks: PushToTalkStreamCallbacks,
  options: PushToTalkStreamOptions = {}
): Promise<PushToTalkStreamSession | null> {
  const base = String(options.apiBase ?? "").trim();
  const token = String(options.apiToken ?? "").trim();
  if (base && token) {
    try {
      const { startDoubaoPushToTalkStream } = await import("./stt-ptt-doubao.ts");
      const doubaoSession = await startDoubaoPushToTalkStream(callbacks, options);
      if (doubaoSession) return doubaoSession;
    } catch {
      /* fallback below */
    }
  }
  return startBrowserPushToTalkStream(callbacks);
}
