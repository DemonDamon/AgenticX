import { router } from "expo-router";
import { useEffect, useState } from "react";
import { GatewayClient } from "../api/client";
import { notifyBindingChanged, onBindingChanged } from "../lib/events";
import { clearBinding, getBinding, getInstallId, type Binding } from "../store";

export interface GatewayState {
  /** 未绑定时为 null */
  client: GatewayClient | null;
  binding: Binding | null;
  loadError: string | null;
}

/**
 * 共享 GatewayClient hook（_layout 全局审批卡 + 各页面复用）：
 * - 读绑定态 → 建 client；未绑定返回 null
 * - 401 统一处理：清绑定 → 广播 bindingChanged（所有实例重建）→ 跳配对页
 * - 绑定态变化（配对成功 / 解绑）通过事件总线触发重建
 */
export function useGateway(): GatewayState {
  const [binding, setBinding] = useState<Binding | null>(null);
  const [client, setClient] = useState<GatewayClient | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => onBindingChanged(() => setReloadToken((t) => t + 1)), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const b = await getBinding();
        if (cancelled) return;
        if (b === null) {
          setBinding(null);
          setClient(null);
          setLoadError(null);
          return;
        }
        const installId = await getInstallId();
        if (cancelled) return;
        setBinding(b);
        setClient(
          new GatewayClient({
            gatewayBase: b.gateway_base,
            installId,
            mobileToken: b.mobile_token,
            onUnauthorized: () => {
              void (async () => {
                await clearBinding();
                notifyBindingChanged();
                router.replace("/pair");
              })();
            },
          }),
        );
        setLoadError(null);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  return { client, binding, loadError };
}
