export type PublishedPolicyVersion = {
  id: string;
  version: number;
};

export type LoadedPolicyVersion = {
  publishId: string;
  version: number;
};

export function matchesPublishedSnapshot(
  published: PublishedPolicyVersion | null | undefined,
  loaded: LoadedPolicyVersion | null | undefined,
): boolean {
  return Boolean(
    published &&
      loaded &&
      published.id === loaded.publishId &&
      published.version === loaded.version,
  );
}
