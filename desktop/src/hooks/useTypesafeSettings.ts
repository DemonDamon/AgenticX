import { useEffect, useState } from "react";
import { useAppStore } from "../store";
import {
  DEFAULT_TYPESAFE_PUBLIC_SETTINGS,
  fetchTypesafeSettings,
  type TypesafePublicSettings,
} from "../utils/typesafe-settings";

let cached: TypesafePublicSettings | null = null;
let inflight: Promise<TypesafePublicSettings> | null = null;
const listeners = new Set<(next: TypesafePublicSettings) => void>();

export function useTypesafeSettings(): TypesafePublicSettings {
  const apiBase = useAppStore((s) => s.apiBase);
  const apiToken = useAppStore((s) => s.apiToken);
  const [settings, setSettings] = useState<TypesafePublicSettings>(
    cached ?? DEFAULT_TYPESAFE_PUBLIC_SETTINGS,
  );

  useEffect(() => {
    const on = (next: TypesafePublicSettings) => setSettings(next);
    listeners.add(on);
    return () => {
      listeners.delete(on);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!inflight) {
        inflight = fetchTypesafeSettings(apiBase, apiToken).finally(() => {
          inflight = null;
        });
      }
      try {
        const next = await inflight;
        cached = next;
        if (!cancelled) setSettings(next);
      } catch {
        if (!cancelled) setSettings(cached ?? DEFAULT_TYPESAFE_PUBLIC_SETTINGS);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [apiBase, apiToken]);

  return settings;
}

export function rememberTypesafeSettings(next: TypesafePublicSettings): void {
  cached = next;
  listeners.forEach((fn) => fn(next));
}
