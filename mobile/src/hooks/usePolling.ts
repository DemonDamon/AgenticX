import { useEffect, useRef } from "react";
import { AppState } from "react-native";

export interface UsePollingOptions {
  /** 轮询间隔（毫秒） */
  intervalMs: number;
  /** 每次轮询执行的异步任务；抛错走 onError，不中断后续轮询 */
  onPoll: () => Promise<void>;
  /** 轮询错误回调（网络错误 / ApiError 等） */
  onError?: (error: unknown) => void;
  /** 停止轮询（页面卸载之外的手动启停） */
  enabled?: boolean;
}

/**
 * 通用轮询 hook：
 * - 挂载立即执行一次，之后按 intervalMs 定时
 * - 页面（App）退到后台时暂停，回前台立即补一次
 * - 上一次请求未完成时跳过本轮，避免堆积
 */
export function usePolling(options: UsePollingOptions): void {
  const { intervalMs, enabled = true } = options;
  // 用 ref 持有最新回调，避免回调身份变化导致定时器反复重建
  const onPollRef = useRef(options.onPoll);
  const onErrorRef = useRef(options.onError);

  useEffect(() => {
    onPollRef.current = options.onPoll;
    onErrorRef.current = options.onError;
  });

  useEffect(() => {
    if (!enabled) return;

    let inFlight = false;
    let stopped = false;

    const tick = async (): Promise<void> => {
      if (inFlight || AppState.currentState !== "active") return;
      inFlight = true;
      try {
        await onPollRef.current();
      } catch (error) {
        if (!stopped) onErrorRef.current?.(error);
      } finally {
        inFlight = false;
      }
    };

    void tick();
    const timer = setInterval(() => {
      void tick();
    }, intervalMs);

    // 回前台立即补一次，不等下一个整周期
    const appStateSub = AppState.addEventListener("change", (state) => {
      if (state === "active") void tick();
    });

    return () => {
      stopped = true;
      clearInterval(timer);
      appStateSub.remove();
    };
  }, [enabled, intervalMs]);
}
