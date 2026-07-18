/** Per-session streaming commit bookkeeping. Keyed by sessionId so two
 *  concurrent streams in the same ChatPane never clobber each other. */
export class StreamCommitRegistry {
  private text = new Map<string, string>();
  private committed = new Map<string, boolean>();
  private midCommit = new Map<string, string | null>();

  beginSession(sid: string): void {
    if (!sid) return;
    this.text.set(sid, "");
    this.committed.set(sid, false);
    this.midCommit.set(sid, null);
  }

  setText(sid: string, text: string): void {
    if (sid) this.text.set(sid, text);
  }

  getText(sid: string): string {
    return this.text.get(sid) ?? "";
  }

  isCommitted(sid: string): boolean {
    return this.committed.get(sid) ?? false;
  }

  markCommitted(sid: string, value = true): void {
    if (sid) this.committed.set(sid, value);
  }

  claimUncommittedText(sid: string): string | null {
    if (!sid || this.isCommitted(sid)) return null;
    const current = this.getText(sid);
    if (!current.trim()) return null;
    this.markCommitted(sid);
    return current;
  }

  setMidCommit(sid: string, text: string | null): void {
    if (sid) this.midCommit.set(sid, text);
  }

  getMidCommit(sid: string): string | null {
    return this.midCommit.get(sid) ?? null;
  }

  /** Reset text+committed at a tool boundary, keep session entry alive. */
  resetTurnSegment(sid: string): void {
    if (!sid) return;
    this.text.set(sid, "");
    this.committed.set(sid, false);
  }

  /** Drop all entries for a finished session. */
  clearSession(sid: string): void {
    if (!sid) return;
    this.text.delete(sid);
    this.committed.delete(sid);
    this.midCommit.delete(sid);
  }
}
