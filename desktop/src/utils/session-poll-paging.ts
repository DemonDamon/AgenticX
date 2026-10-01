/**
 * Decide whether an external poll merge may clear message paging
 * (oldestLoadedIndex / hasOlderMessages). Tail-only growth must keep paging.
 *
 * Author: Damon Li
 */

export type PollPagingResetInput = {
  hadOlder: boolean;
  oldestLoadedIndex: number;
  mergedLen: number;
  previousLen: number;
  /** True when this poll only merged a disk tail into the visible window. */
  grewTailOnly: boolean;
};

/**
 * Return true only for an authoritative full-history replacement.
 * When `grewTailOnly` is true (normal IM/delegation poll), never reset.
 */
export function shouldResetPagingAfterPollMerge(opts: PollPagingResetInput): boolean {
  if (opts.grewTailOnly) return false;
  if (!opts.hadOlder && opts.oldestLoadedIndex <= 0) return false;
  // Non-tail merge that already had a paging window — allow reset only when
  // the merge grew the in-memory list beyond a simple append (full replace).
  if (opts.mergedLen <= opts.previousLen) return false;
  return true;
}
