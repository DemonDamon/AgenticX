import { useCallback, useEffect, useRef, useState } from "react";
import { loadPttShortcut, shouldStopPttOnKeyUp, matchPttShortcut } from "../voice/ptt-config";
import { startPushToTalkStream, type PushToTalkStreamSession } from "../voice/stt-ptt";

type UseVoicePushToTalkOptions = {
  enabled?: boolean;
  composerEmpty: boolean;
  apiBase?: string;
  apiToken?: string;
  inputDeviceId?: string;
  language?: string;
  onCommit: (text: string) => void;
  onError?: (message: string) => void;
};

export function useVoicePushToTalk({
  enabled = true,
  composerEmpty,
  apiBase,
  apiToken,
  inputDeviceId,
  language = "zh",
  onCommit,
  onError,
}: UseVoicePushToTalkOptions) {
  const [active, setActive] = useState(false);
  const [liveText, setLiveText] = useState("");
  const sessionRef = useRef<PushToTalkStreamSession | null>(null);
  const activeRef = useRef(false);
  const startingRef = useRef(false);

  const cancelPtt = useCallback(() => {
    sessionRef.current?.cancel();
    sessionRef.current = null;
    activeRef.current = false;
    startingRef.current = false;
    setActive(false);
    setLiveText("");
  }, []);

  const stopPtt = useCallback(async () => {
    if (!sessionRef.current) {
      activeRef.current = false;
      setActive(false);
      setLiveText("");
      return;
    }
    const session = sessionRef.current;
    sessionRef.current = null;
    activeRef.current = false;
    setActive(false);
    try {
      const text = await session.stop();
      setLiveText("");
      if (text.trim()) onCommit(text);
    } catch {
      setLiveText("");
      onError?.("语音输入结束失败，请重试");
    }
  }, [onCommit, onError]);

  const startPtt = useCallback(async () => {
    if (!enabled || activeRef.current || startingRef.current || sessionRef.current) return;
    startingRef.current = true;
    setLiveText("");
    try {
      const session = await startPushToTalkStream(
        {
          onInterim: setLiveText,
          onError: (message) => {
            onError?.(message);
            void stopPtt();
          },
        },
        {
          apiBase,
          apiToken,
          inputDeviceId,
          language,
        }
      );
      if (!session) {
        onError?.("无法启动流式语音输入");
        return;
      }
      sessionRef.current = session;
      activeRef.current = true;
      setActive(true);
    } finally {
      startingRef.current = false;
    }
  }, [enabled, apiBase, apiToken, inputDeviceId, language, onError, stopPtt]);

  useEffect(() => {
    if (!enabled) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const shortcut = loadPttShortcut();
      if (!matchPttShortcut(event, shortcut, composerEmpty)) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-agx-ptt-ignore='true']")) return;
      event.preventDefault();
      event.stopPropagation();
      void startPtt();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const shortcut = loadPttShortcut();
      if (!shouldStopPttOnKeyUp(event, shortcut, activeRef.current)) return;
      event.preventDefault();
      event.stopPropagation();
      void stopPtt();
    };

    const onWindowBlur = () => {
      if (!activeRef.current) return;
      void stopPtt();
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onWindowBlur);
      cancelPtt();
    };
  }, [enabled, composerEmpty, startPtt, stopPtt, cancelPtt]);

  return {
    pttActive: active,
    pttLiveText: liveText,
    cancelPtt,
  };
}
