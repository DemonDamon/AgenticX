import type { FeatureUsageResolution, FeatureUsageState, FeatureUsageWindow, MeteredFeature } from "@agenticx/config";

const WINDOW_LABEL: Record<FeatureUsageWindow, string> = {
  day: "今日",
  week: "本周",
  month: "本月",
};

const FEATURE_LABEL: Record<MeteredFeature, string> = {
  search_provider_calls: "联网搜索",
  deep_research_runs: "深度研究",
};

const UNAVAILABLE_MESSAGE: Record<MeteredFeature, string> = {
  search_provider_calls: "暂时无法确认搜索次数，请稍后再试",
  deep_research_runs: "暂时无法确认研究次数，请稍后再试",
};

export function featureUsageExhaustedMessage(
  feature: MeteredFeature,
  window: FeatureUsageWindow,
  limit: number,
  source?: FeatureUsageResolution["source"],
): string {
  const scopeLabel = source === "company" ? "公司共享"
    : source === "department" ? "部门共享"
      : source === "user" ? "个人特例"
        : source === "group" ? "用户组个人"
          : source === "default" ? "默认个人"
            : "";
  const scope = scopeLabel ? `（${scopeLabel}上限 ${limit} 次）` : `（上限 ${limit} 次）`;
  return `${WINDOW_LABEL[window]}${FEATURE_LABEL[feature]}次数已用完${scope}，请联系管理员调整`;
}

/**
 * Thrown instead of returning a failure flag so a search provider failover
 * cannot treat an exhausted ceiling as a provider outage.
 */
export class FeatureUsageLimitError extends Error {
  readonly feature: MeteredFeature;
  readonly window: FeatureUsageWindow;
  readonly limit: number;
  readonly used: number;
  readonly source: FeatureUsageResolution["source"] | undefined;
  readonly userMessage: string;

  constructor(feature: MeteredFeature, state: NonNullable<FeatureUsageState["binding"]>) {
    super(`member ${feature} quota exhausted for the ${state.window}`);
    this.name = "FeatureUsageLimitError";
    this.feature = feature;
    this.window = state.window;
    this.limit = state.limit;
    this.used = state.used;
    this.source = state.source;
    this.userMessage = featureUsageExhaustedMessage(feature, state.window, state.limit, state.source);
  }
}

export function isFeatureUsageLimitError(error: unknown): error is FeatureUsageLimitError {
  return error instanceof FeatureUsageLimitError;
}

export class FeatureUsageUnavailableError extends Error {
  readonly feature: MeteredFeature;
  readonly userMessage: string;

  constructor(feature: MeteredFeature, cause?: unknown) {
    super(`${feature} quota unavailable`, { cause });
    this.name = "FeatureUsageUnavailableError";
    this.feature = feature;
    this.userMessage = UNAVAILABLE_MESSAGE[feature];
  }
}

export function isFeatureUsageUnavailableError(error: unknown): error is FeatureUsageUnavailableError {
  return error instanceof FeatureUsageUnavailableError;
}

/** Log a swallowed read. Callers still fail closed; the log is how an outage stays visible. */
export function reportFeatureUsageFailure(context: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[${context}] database call failed, using fallback: ${message}`);
}
