export const DEFAULT_MAX_DEEP_RESEARCH_PROVIDER_CALLS = 24;
export const MIN_MAX_DEEP_RESEARCH_PROVIDER_CALLS = 6;
export const MAX_MAX_DEEP_RESEARCH_PROVIDER_CALLS = 60;

export const DEFAULT_DEEP_RESEARCH_BUDGET_LIMITS = {
  searchQueries: 32,
  providerCalls: DEFAULT_MAX_DEEP_RESEARCH_PROVIDER_CALLS,
  pageFetches: 40,
  modelCalls: 48,
} as const;

export type DeepResearchBudgetResource = keyof typeof DEFAULT_DEEP_RESEARCH_BUDGET_LIMITS;

export type DeepResearchBudgetLimits = Record<DeepResearchBudgetResource, number>;

export type DeepResearchBudgetUsage = {
  used: number;
  limit: number;
  remaining: number;
};

export type DeepResearchBudgetSnapshot = Record<
  DeepResearchBudgetResource,
  DeepResearchBudgetUsage
>;

export function isValidMaxDeepResearchProviderCalls(value: unknown): value is number {
  return (
    Number.isInteger(value) &&
    (value as number) >= MIN_MAX_DEEP_RESEARCH_PROVIDER_CALLS &&
    (value as number) <= MAX_MAX_DEEP_RESEARCH_PROVIDER_CALLS
  );
}

export function normalizeMaxDeepResearchProviderCalls(value: unknown): number {
  return isValidMaxDeepResearchProviderCalls(value)
    ? value
    : DEFAULT_MAX_DEEP_RESEARCH_PROVIDER_CALLS;
}

export class DeepResearchBudgetExceededError extends Error {
  constructor(
    readonly resource: DeepResearchBudgetResource,
    readonly limit: number,
  ) {
    super(`deep research ${resource} budget exhausted (${limit})`);
    this.name = "DeepResearchBudgetExceededError";
  }
}

function normalizeLimit(value: unknown, fallback: number): number {
  return Number.isInteger(value) && (value as number) >= 0 ? (value as number) : fallback;
}

/**
 * Request-scoped hard ledger. JavaScript executes each debit synchronously, so
 * concurrent lane promises cannot oversubscribe a resource between check and debit.
 */
export class DeepResearchBudgetLedger {
  private readonly limits: DeepResearchBudgetLimits;
  private readonly used: Record<DeepResearchBudgetResource, number> = {
    searchQueries: 0,
    providerCalls: 0,
    pageFetches: 0,
    modelCalls: 0,
  };

  constructor(limits: Partial<DeepResearchBudgetLimits> = {}) {
    this.limits = {
      searchQueries: normalizeLimit(
        limits.searchQueries,
        DEFAULT_DEEP_RESEARCH_BUDGET_LIMITS.searchQueries,
      ),
      providerCalls: normalizeLimit(
        limits.providerCalls,
        DEFAULT_DEEP_RESEARCH_BUDGET_LIMITS.providerCalls,
      ),
      pageFetches: normalizeLimit(
        limits.pageFetches,
        DEFAULT_DEEP_RESEARCH_BUDGET_LIMITS.pageFetches,
      ),
      modelCalls: normalizeLimit(
        limits.modelCalls,
        DEFAULT_DEEP_RESEARCH_BUDGET_LIMITS.modelCalls,
      ),
    };
  }

  remaining(resource: DeepResearchBudgetResource): number {
    return Math.max(0, this.limits[resource] - this.used[resource]);
  }

  tryConsume(resource: DeepResearchBudgetResource, count = 1): boolean {
    if (!Number.isInteger(count) || count < 0) {
      throw new TypeError("budget debit must be a non-negative integer");
    }
    if (count > this.remaining(resource)) return false;
    this.used[resource] += count;
    return true;
  }

  consume(resource: DeepResearchBudgetResource, count = 1): void {
    if (!this.tryConsume(resource, count)) {
      throw new DeepResearchBudgetExceededError(resource, this.limits[resource]);
    }
  }

  /** Debit as much of a batch as remains, returning the admitted item count. */
  take(resource: DeepResearchBudgetResource, requested: number): number {
    if (!Number.isInteger(requested) || requested < 0) {
      throw new TypeError("budget request must be a non-negative integer");
    }
    const admitted = Math.min(requested, this.remaining(resource));
    this.used[resource] += admitted;
    return admitted;
  }

  snapshot(): DeepResearchBudgetSnapshot {
    return Object.fromEntries(
      (Object.keys(this.limits) as DeepResearchBudgetResource[]).map((resource) => [
        resource,
        {
          used: this.used[resource],
          limit: this.limits[resource],
          remaining: this.remaining(resource),
        },
      ]),
    ) as DeepResearchBudgetSnapshot;
  }
}

export function isDeepResearchBudgetExceeded(
  error: unknown,
  resource?: DeepResearchBudgetResource,
): error is DeepResearchBudgetExceededError {
  return (
    error instanceof DeepResearchBudgetExceededError &&
    (resource === undefined || error.resource === resource)
  );
}
