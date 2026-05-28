export type SttHandler = (text: string) => void;
export type SttInterimHandler = (text: string) => void;
export type SttPhase = "idle" | "recording" | "transcribing";
export type SttBackend = "server" | "browser";

export type SttCallbacks = {
  onFinal?: SttHandler;
  onInterim?: SttInterimHandler;
  onPhase?: (phase: SttPhase) => void;
  onError?: (message: string) => void;
};

export type SttSessionOptions = {
  apiBase?: string;
  apiToken?: string;
  inputDeviceId?: string;
  /** Safety cap for a single dictation take. Default 120s. */
  maxDurationMs?: number;
  language?: string;
};

export type SttSession = {
  stop: () => void;
  cancel: () => void;
};

const DEFAULT_MAX_DURATION_MS = 120_000;
const DICTATION_MIME_CANDIDATES = [
  "audio/ogg;codecs=opus",
  "audio/webm;codecs=opus",
  "audio/webm",
] as const;

export function pickDictationMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const mimeType of DICTATION_MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(mimeType)) return mimeType;
  }
  return "";
}

function extensionForMimeType(mimeType: string): string {
  const mime = mimeType.toLowerCase();
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  return "webm";
}

let mediaRecorder: MediaRecorder | null = null;
let mediaStream: MediaStream | null = null;
let chunks: Blob[] = [];
let stopBrowserFallback: (() => void) | null = null;
let recordGeneration = 0;
let maxDurationTimer: number | null = null;
let activeSession: SttSession | null = null;

export function appendDictationText(existing: string, incoming: string): string {
  const next = incoming.trim();
  if (!next) return existing;
  const base = existing.trim();
  return base ? `${base} ${next}` : next;
}

export function resolveSttBackend(options: Pick<SttSessionOptions, "apiBase" | "apiToken">): SttBackend {
  const base = String(options.apiBase ?? "").trim();
  const token = String(options.apiToken ?? "").trim();
  return base && token ? "server" : "browser";
}

export function parseTranscribeResponse(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const text = (body as { text?: unknown }).text;
  return typeof text === "string" ? text.trim() : "";
}

function clearMaxDurationTimer() {
  if (maxDurationTimer != null) {
    window.clearTimeout(maxDurationTimer);
    maxDurationTimer = null;
  }
}

function setPhase(callbacks: SttCallbacks, phase: SttPhase) {
  callbacks.onPhase?.(phase);
}

function cleanupMediaTracks() {
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }
}

export function startBrowserFallback(
  onResult: SttHandler,
  onInterim?: SttInterimHandler,
  onError?: (message: string) => void
): (() => void) | null {
  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SpeechRecognition) {
    onError?.("当前环境不支持浏览器语音识别");
    return null;
  }
  const recognition = new SpeechRecognition();
  recognition.lang = "zh-CN";
  recognition.interimResults = true;
  recognition.continuous = true;
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
  recognition.onerror = () => {
    onError?.("浏览器语音识别失败，请检查麦克风权限");
  };
  recognition.start();
  return () => recognition.stop();
}

async function transcribeViaServer(
  audioBlob: Blob,
  options: SttSessionOptions
): Promise<string> {
  const base = String(options.apiBase ?? "").replace(/\/+$/, "");
  const token = String(options.apiToken ?? "").trim();
  if (!base || !token) return "";

  const form = new FormData();
  const ext = extensionForMimeType(audioBlob.type || "audio/webm");
  form.append("file", audioBlob, `dictation.${ext}`);
  if (options.language) form.append("language", options.language);

  const resp = await fetch(`${base}/api/voice/transcribe`, {
    method: "POST",
    headers: {
      "x-agx-desktop-token": token,
    },
    body: form,
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(detail || `HTTP ${resp.status}`);
  }
  const body = (await resp.json()) as unknown;
  return parseTranscribeResponse(body);
}

async function finalizeRecordedAudio(
  generation: number,
  callbacks: SttCallbacks,
  options: SttSessionOptions
) {
  if (generation !== recordGeneration) return;
  const audioBlob = new Blob(chunks, { type: chunks[0]?.type || "audio/webm" });
  chunks = [];
  cleanupMediaTracks();

  if (!audioBlob.size) {
    setPhase(callbacks, "idle");
    callbacks.onError?.("未录到有效音频，请重试");
    return;
  }

  setPhase(callbacks, "transcribing");
  try {
    const text = await transcribeViaServer(audioBlob, options);
    if (generation !== recordGeneration) return;
    if (text) {
      setPhase(callbacks, "idle");
      callbacks.onFinal?.(text);
      return;
    }
    throw new Error("empty transcription");
  } catch {
    if (generation !== recordGeneration) return;
    setPhase(callbacks, "recording");
    callbacks.onError?.("云端转写失败，已切换浏览器语音识别，请继续说话");
    stopBrowserFallback = startBrowserFallback(
      (text) => {
        if (generation !== recordGeneration) return;
        setPhase(callbacks, "idle");
        callbacks.onFinal?.(text);
      },
      (interim) => {
        if (generation !== recordGeneration) return;
        callbacks.onInterim?.(interim);
      },
      (message) => {
        if (generation !== recordGeneration) return;
        setPhase(callbacks, "idle");
        callbacks.onError?.(message);
      }
    );
    if (!stopBrowserFallback) {
      setPhase(callbacks, "idle");
      callbacks.onError?.("语音转写失败，请检查设置中的 OpenAI / 豆包凭证或浏览器语音识别支持");
    }
  }
}

function beginBrowserDictation(generation: number, callbacks: SttCallbacks) {
  setPhase(callbacks, "recording");
  stopBrowserFallback = startBrowserFallback(
    (text) => {
      if (generation !== recordGeneration) return;
      setPhase(callbacks, "idle");
      callbacks.onFinal?.(text);
    },
    (interim) => {
      if (generation !== recordGeneration) return;
      callbacks.onInterim?.(interim);
    },
    (message) => {
      if (generation !== recordGeneration) return;
      setPhase(callbacks, "idle");
      callbacks.onError?.(message);
    }
  );
  if (!stopBrowserFallback) {
    setPhase(callbacks, "idle");
    callbacks.onError?.("无法启动浏览器语音识别，请检查麦克风权限");
  }
}

async function beginServerDictation(
  generation: number,
  callbacks: SttCallbacks,
  options: SttSessionOptions
) {
  chunks = [];
  const constraints: MediaStreamConstraints = {
    audio: options.inputDeviceId ? { deviceId: { exact: options.inputDeviceId } } : true,
  };
  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    if (generation !== recordGeneration) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    mediaStream = stream;
    const mimeType = pickDictationMimeType();
    mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (evt) => {
      if (evt.data.size > 0) chunks.push(evt.data);
    };
    mediaRecorder.onstop = () => {
      void finalizeRecordedAudio(generation, callbacks, options);
    };
    mediaRecorder.start();
    setPhase(callbacks, "recording");

    const maxMs = options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
    clearMaxDurationTimer();
    maxDurationTimer = window.setTimeout(() => {
      if (generation !== recordGeneration) return;
      if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
      }
      mediaRecorder = null;
    }, maxMs);
  } catch {
    if (generation !== recordGeneration) return;
    callbacks.onError?.("无法访问麦克风，尝试浏览器语音识别");
    beginBrowserDictation(generation, callbacks);
  }
}

export async function startDictation(
  callbacks: SttCallbacks,
  options: SttSessionOptions = {}
): Promise<SttSession> {
  cancelDictation();
  recordGeneration += 1;
  const generation = recordGeneration;
  const backend = resolveSttBackend(options);

  const session: SttSession = {
    stop: () => {
      if (generation !== recordGeneration) return;
      clearMaxDurationTimer();
      if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
        mediaRecorder = null;
        return;
      }
      if (stopBrowserFallback) {
        stopBrowserFallback();
        stopBrowserFallback = null;
      }
      cleanupMediaTracks();
      setPhase(callbacks, "idle");
    },
    cancel: () => {
      cancelDictation();
      setPhase(callbacks, "idle");
    },
  };
  activeSession = session;

  if (backend === "browser") {
    beginBrowserDictation(generation, callbacks);
  } else {
    await beginServerDictation(generation, callbacks, options);
  }

  return session;
}

export function cancelDictation(): void {
  recordGeneration += 1;
  clearMaxDurationTimer();
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.onstop = null;
    mediaRecorder.stop();
  }
  mediaRecorder = null;
  chunks = [];
  cleanupMediaTracks();
  if (stopBrowserFallback) {
    stopBrowserFallback();
    stopBrowserFallback = null;
  }
  activeSession = null;
}

/** Backward-compatible wrapper for legacy call sites. */
export async function startRecording(
  onResult: SttHandler,
  onInterim?: SttInterimHandler,
  options?: SttSessionOptions
): Promise<() => void> {
  const session = await startDictation(
    {
      onFinal: onResult,
      onInterim,
    },
    options
  );
  return () => session.stop();
}

export function stopRecording(): void {
  activeSession?.stop();
  activeSession = null;
}
