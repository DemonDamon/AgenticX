/** Coalesce dirty response snapshots; never persist once per model token. */
export function createResponseCheckpoint<T extends { content: string }>(options: {
  read: () => T | undefined;
  save: (snapshot: T) => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const minInterval = 5_000;
  const maxInterval = 15_000;
  const minCharacters = 2_000;
  let savedLength = options.read()?.content.length ?? 0;
  let firstWrite = savedLength === 0;
  let savedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let saving = false;
  let stopped = false;

  function changed() {
    if (stopped || saving) return;
    const snapshot = options.read();
    if (!snapshot || snapshot.content.length <= savedLength) return;
    // An early small snapshot enables Continue after a quick refresh. Later
    // writes keep the usual batching interval, including retries on failure.
    const interval = firstWrite ? 1_000
      : snapshot.content.length - savedLength >= minCharacters ? minInterval : maxInterval;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => { void checkpoint(); }, Math.max(0, savedAt + interval - Date.now()));
  }

  async function checkpoint() {
    timer = undefined;
    if (stopped) return;
    const snapshot = options.read();
    if (!snapshot || snapshot.content.length <= savedLength) return;
    saving = true;
    firstWrite = false;
    savedAt = Date.now();
    try {
      await options.save(snapshot);
      savedLength = snapshot.content.length;
    } catch (error) {
      options.onError(error);
    } finally {
      saving = false;
      changed();
    }
  }

  return {
    changed,
    stop() {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}
