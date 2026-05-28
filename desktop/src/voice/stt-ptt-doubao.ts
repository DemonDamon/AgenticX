import type { PushToTalkStreamCallbacks, PushToTalkStreamSession } from "./stt-ptt";
import { floatFrameToTargetPcm16, httpBaseToWs } from "./pcm-utils";

type DoubaoPttOptions = {
  apiBase?: string;
  apiToken?: string;
  inputDeviceId?: string;
  language?: string;
};

type StreamMessage = {
  type?: string;
  text?: string;
  message?: string;
};

export async function startDoubaoPushToTalkStream(
  callbacks: PushToTalkStreamCallbacks,
  options: DoubaoPttOptions
): Promise<PushToTalkStreamSession | null> {
  const base = String(options.apiBase ?? "").replace(/\/+$/, "");
  const token = String(options.apiToken ?? "").trim();
  if (!base || !token) return null;

  let mediaStream: MediaStream | null = null;
  let audioCtx: AudioContext | null = null;
  let proc: ScriptProcessorNode | null = null;
  let ws: WebSocket | null = null;
  let stopped = false;
  let latestText = "";
  let resolveStop: ((text: string) => void) | null = null;
  let rejectStop: ((error: Error) => void) | null = null;

  const cleanupMedia = () => {
    proc?.disconnect();
    proc = null;
    if (audioCtx) {
      void audioCtx.close().catch(() => undefined);
      audioCtx = null;
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      mediaStream = null;
    }
  };

  const cleanupWs = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "stop" }));
      } catch {
        /* ignore */
      }
    }
    ws?.close();
    ws = null;
  };

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: options.inputDeviceId ? { deviceId: { exact: options.inputDeviceId } } : true,
    });
  } catch {
    callbacks.onError?.("无法访问麦克风");
    return null;
  }

  const wsUrl = `${httpBaseToWs(base)}/ws/voice/stream-transcribe?x_agx_desktop_token=${encodeURIComponent(token)}`;
  ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";

  const session: PushToTalkStreamSession = {
    stop: () =>
      new Promise<string>((resolve, reject) => {
        if (stopped) {
          resolve(latestText);
          return;
        }
        stopped = true;
        resolveStop = resolve;
        rejectStop = reject;
        cleanupMedia();
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          resolve(latestText);
          resolveStop = null;
          rejectStop = null;
          cleanupWs();
          return;
        }
        try {
          ws.send(JSON.stringify({ type: "stop" }));
        } catch (error) {
          cleanupWs();
          reject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        window.setTimeout(() => {
          if (!resolveStop) return;
          resolveStop(latestText);
          resolveStop = null;
          rejectStop = null;
          cleanupWs();
        }, 2500);
      }),
    cancel: () => {
      stopped = true;
      resolveStop = null;
      rejectStop = null;
      cleanupMedia();
      cleanupWs();
    },
  };

  try {
    await new Promise<void>((resolve, reject) => {
      if (!ws) {
        reject(new Error("websocket unavailable"));
        return;
      }
      let ready = false;
      ws.onopen = () => {
        ws?.send(
          JSON.stringify({
            type: "start",
            language: options.language || "zh-CN",
          })
        );
      };
      ws.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        let body: StreamMessage;
        try {
          body = JSON.parse(event.data) as StreamMessage;
        } catch {
          return;
        }
        const kind = String(body.type || "").toLowerCase();
        if (kind === "ready") {
          ready = true;
          resolve();
          return;
        }
        if (kind === "error") {
          const message = String(body.message || "豆包流式转写失败");
          callbacks.onError?.(message);
          reject(new Error(message));
          return;
        }
        const text = String(body.text || "").trim();
        if (!text) return;
        latestText = text;
        callbacks.onInterim(text);
        if (kind === "final" && resolveStop) {
          resolveStop(text);
          resolveStop = null;
          rejectStop = null;
          cleanupWs();
        }
      };
      ws.onerror = () => {
        if (!ready) reject(new Error("豆包流式转写连接失败"));
      };
      ws.onclose = () => {
        if (!ready) reject(new Error("豆包流式转写连接已关闭"));
      };
    });

    if (ws) {
      ws.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        let body: StreamMessage;
        try {
          body = JSON.parse(event.data) as StreamMessage;
        } catch {
          return;
        }
        const kind = String(body.type || "").toLowerCase();
        if (kind === "error") {
          callbacks.onError?.(String(body.message || "豆包流式转写失败"));
          return;
        }
        const text = String(body.text || "").trim();
        if (!text) return;
        latestText = text;
        callbacks.onInterim(text);
        if (kind === "final" && resolveStop) {
          resolveStop(text);
          resolveStop = null;
          rejectStop = null;
          cleanupWs();
        }
      };
      ws.onerror = () => {
        callbacks.onError?.("豆包流式转写连接异常");
      };
      ws.onclose = () => {
        /* session stop() owns final cleanup */
      };
    }
  } catch (error) {
    cleanupMedia();
    cleanupWs();
    callbacks.onError?.(error instanceof Error ? error.message : "豆包流式转写不可用");
    return null;
  }

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    cleanupMedia();
    cleanupWs();
    return null;
  }

  audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(mediaStream);
  proc = audioCtx.createScriptProcessor(4096, 1, 1);
  const micRate = audioCtx.sampleRate;
  const targetRate = 16000;
  proc.onaudioprocess = (evt) => {
    if (stopped || !ws || ws.readyState !== WebSocket.OPEN) return;
    const input = evt.inputBuffer.getChannelData(0);
    const pcm = floatFrameToTargetPcm16(input, micRate, targetRate);
    if (!pcm.byteLength) return;
    try {
      ws.send(pcm);
    } catch {
      /* ignore send while closing */
    }
  };
  source.connect(proc);
  proc.connect(audioCtx.destination);

  return session;
}
