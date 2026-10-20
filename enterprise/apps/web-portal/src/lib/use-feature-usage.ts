"use client";

import * as React from "react";
import type { FeatureUsageState, MeteredFeature } from "@agenticx/config";

/**
 * Remaining search and deep-research allowance for the signed-in member.
 *
 * Refreshed after a turn, not on a timer: the number moves when this member
 * spends a call, so polling would mostly repeat an unchanged answer.
 */

export type FeatureUsageStates = Partial<Record<MeteredFeature, FeatureUsageState>>;

type Envelope = {
  code?: string;
  data?: { features?: FeatureUsageStates };
};

export function useFeatureUsage(enabled = true): {
  states: FeatureUsageStates;
  refresh: () => void;
} {
  const [states, setStates] = React.useState<FeatureUsageStates>({});
  const [nonce, setNonce] = React.useState(0);

  React.useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/workspace/feature-usage", { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as Envelope;
        if (cancelled || payload.code !== "00000") return;
        setStates(payload.data?.features ?? {});
      } catch {
        // The badge is an aid. The server gate does not depend on it.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, nonce]);

  const refresh = React.useCallback(() => setNonce((value) => value + 1), []);
  return { states, refresh };
}
