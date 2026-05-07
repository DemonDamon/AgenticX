type ProvidersEnvelope<T> = {
  data?: {
    providers?: T[];
    samlGloballyDisabled?: boolean;
  };
};

export function parseProvidersPayload<T>(payload: unknown): {
  providers: T[];
  samlGloballyDisabled: boolean;
} {
  const envelope = (payload ?? {}) as ProvidersEnvelope<T>;
  return {
    providers: Array.isArray(envelope.data?.providers) ? envelope.data.providers : [],
    samlGloballyDisabled: envelope.data?.samlGloballyDisabled === true,
  };
}
