import { AlertTriangle, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore, type Avatar } from "../../store";
import { sendTextToPane } from "../../chat/send-text-to-pane";
import { ExecutionTimeline } from "../graph/ExecutionTimeline";
import { EMPTY_PANE_GRAPH_STATE } from "../graph/graph-types";
import { useGraphRunStore } from "../graph/useGraphRun";
import {
  getReplayExport,
  listReplayEvents,
  listReplayRuns,
} from "./replay-api";
import { buildCausalChain } from "./replay-causal-chain";
import { ReplayControls } from "./ReplayControls";
import { ReplayEventDetail } from "./ReplayEventDetail";
import { projectReplay } from "./replay-projection";
import { useReplayStore } from "./replay-store";
import { ReplaySummaryBar } from "./ReplaySummaryBar";
import { ReplayTimeline } from "./ReplayTimeline";
import type { ReplayEvent, ReplayRun } from "./replay-types";
import {
  BranchFromStepDialog,
  type BranchProgressStage,
} from "./BranchFromStepDialog";
import {
  createRunBranch,
  RunBranchRequestError,
  type BranchEffectWarning,
} from "./branch-client";

type Props = {
  paneId: string;
  sessionId: string;
  apiBase: string;
  apiToken: string;
  avatarById: Map<string, Avatar>;
  agentIds: string[];
  metaLeaderLabel: string;
  focusTarget?: { runId: string; eventId: string };
  onOpenSubagentRun?: (runId: string) => void;
  onOpenArtifact?: (path: string) => void;
};

export type ReplayPayloadErrors = Readonly<Record<string, string>>;

export function setPayloadErrorForEvent(
  current: ReplayPayloadErrors,
  eventId: string,
  error: string | null,
): ReplayPayloadErrors {
  if (error === null) {
    const remaining = { ...current };
    delete remaining[eventId];
    return remaining;
  }
  return { ...current, [eventId]: error };
}

export function payloadErrorForEvent(
  errors: ReplayPayloadErrors,
  eventId: string | null | undefined,
): string | null {
  return eventId ? errors[eventId] ?? null : null;
}

const TERMINAL_REPLAY_STATUSES = new Set<ReplayRun["status"]>([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

export function shouldLoadAllReplayPages(
  status: ReplayRun["status"],
  hasMore: boolean,
  blocked: boolean,
): boolean {
  return TERMINAL_REPLAY_STATUSES.has(status) && hasMore && !blocked;
}

function preferredRun(runs: ReplayRun[]): ReplayRun | undefined {
  const sorted = [...runs].sort((a, b) => b.createdAt - a.createdAt);
  return sorted.find((run) => run.status === "running")
    ?? sorted.find((run) => run.status === "completed")
    ?? sorted[0];
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

export function resolveBranchPreview(
  events: ReplayEvent[],
  selected: ReplayEvent,
): ReplayEvent | null {
  const latestGap = events
    .filter((event) => event.type === "ledger_gap" && event.seq <= selected.seq)
    .reduce((highest, event) => Math.max(highest, event.seq), 0);
  const upperSeq = selected.type === "tool_call" ? selected.seq - 1 : selected.seq;
  return [...events]
    .filter((event) => (
      event.seq > latestGap
      && event.seq <= upperSeq
      && event.branchable
      && Boolean(event.checkpointRef)
    ))
    .sort((left, right) => right.seq - left.seq)[0] ?? null;
}

export function resolveBranchAvailability(
  run: ReplayRun,
  events: ReplayEvent[],
  selected: ReplayEvent,
): { event: ReplayEvent | null; reason: string | null } {
  if (run.completeness !== "complete") {
    return { event: null, reason: "run_incomplete" };
  }
  if (!TERMINAL_REPLAY_STATUSES.has(run.status)) {
    return { event: null, reason: "source_session_running" };
  }
  const resolved = resolveBranchPreview(events, selected);
  if (resolved) return { event: resolved, reason: null };
  const latestGap = events
    .filter((event) => event.type === "ledger_gap" && event.seq <= selected.seq)
    .reduce((highest, event) => Math.max(highest, event.seq), 0);
  const upperSeq = selected.type === "tool_call" ? selected.seq - 1 : selected.seq;
  const candidates = [...events]
    .filter((event) => event.seq > latestGap && event.seq <= upperSeq)
    .sort((left, right) => right.seq - left.seq);
  const missingCheckpoint = candidates.find(
    (event) => event.branchable && !event.checkpointRef,
  );
  if (missingCheckpoint) return { event: null, reason: "checkpoint_unavailable" };
  const unavailable = candidates.find(
    (event) => Boolean(event.checkpointRef) && Boolean(event.unbranchableReason),
  );
  return {
    event: null,
    reason: unavailable?.unbranchableReason
      ?? selected.unbranchableReason
      ?? "no_stable_checkpoint",
  };
}

export async function copyReplayReview(
  apiBase: string,
  apiToken: string,
  runId: string,
  writeText: (markdown: string) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  const markdown = await getReplayExport(apiBase, apiToken, runId, "markdown", { signal });
  await writeText(markdown);
}

export function RunReplayPanel({
  paneId,
  sessionId,
  apiBase,
  apiToken,
  avatarById,
  agentIds,
  metaLeaderLabel,
  focusTarget,
  onOpenSubagentRun,
  onOpenArtifact,
}: Props) {
  const { t } = useTranslation("workspace");
  const replay = useReplayStore((store) => store.byPane[paneId]);
  const graphSteps = useGraphRunStore(
    (store) => store.byPane[paneId]?.toolStepsByNode ?? EMPTY_PANE_GRAPH_STATE.toolStepsByNode,
  );
  const hasGraphSteps = Object.values(graphSteps).some((steps) => steps.length > 0);
  const [runs, setRuns] = useState<ReplayRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [legacy, setLegacy] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [payloadLoadingId, setPayloadLoadingId] = useState<string | null>(null);
  const [payloadErrors, setPayloadErrors] = useState<ReplayPayloadErrors>({});
  const [branchEvent, setBranchEvent] = useState<ReplayEvent | null>(null);
  const [branchSubmitting, setBranchSubmitting] = useState(false);
  const [branchStage, setBranchStage] = useState<BranchProgressStage>("validate");
  const [branchError, setBranchError] = useState<{ code: string; detail: string } | null>(null);
  const copyFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const auxiliaryControllers = useRef<Set<AbortController>>(new Set());
  const locatingTarget = useRef<string | null>(null);
  const appliedTarget = useRef<string | null>(null);

  useEffect(() => {
    useReplayStore.getState().resetPane(paneId);
    setRuns([]);
    setSelectedRunId("");
    setLegacy(false);
    setListError(null);
    if (!sessionId || !apiBase) {
      setListLoading(false);
      return;
    }
    let disposed = false;
    let inFlight = false;
    let controller: AbortController | null = null;
    setListLoading(true);
    const refreshRuns = async (initial: boolean): Promise<void> => {
      if (disposed || inFlight) return;
      inFlight = true;
      controller = new AbortController();
      const requestController = controller;
      try {
        const response = await listReplayRuns(apiBase, apiToken, sessionId, {
          signal: requestController.signal,
        });
        if (disposed || requestController.signal.aborted) return;
        const sorted = [...response.runs].sort((a, b) => b.createdAt - a.createdAt);
        setRuns(sorted);
        setLegacy(response.legacy);
        const targetMissing = focusTarget?.runId
          && !sorted.some((run) => run.runId === focusTarget.runId);
        setListError(targetMissing ? t("replay.sourceRunUnavailable") : null);
        setSelectedRunId((current) => {
          if (focusTarget?.runId && sorted.some((run) => run.runId === focusTarget.runId)) {
            return focusTarget.runId;
          }
          if (sorted.some((run) => run.runId === current)) return current;
          return preferredRun(sorted)?.runId ?? "";
        });
      } catch (error) {
        if (!disposed && !isAbortError(error)) {
          setListError(error instanceof Error ? error.message : String(error));
          if (initial) setRuns([]);
        }
      } finally {
        inFlight = false;
        if (initial && !disposed && !requestController.signal.aborted) {
          setListLoading(false);
        }
      }
    };
    void refreshRuns(true);
    const timer = window.setInterval(() => void refreshRuns(false), 2_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      controller?.abort();
    };
  }, [apiBase, apiToken, focusTarget?.runId, paneId, sessionId, t]);

  const selectedRunBelongsToSession = runs.some(
    (run) => run.runId === selectedRunId && run.sessionId === sessionId,
  );

  useEffect(() => {
    if (
      !selectedRunId
      || !sessionId
      || !apiBase
      || !selectedRunBelongsToSession
    ) return;
    setPayloadLoadingId(null);
    setPayloadErrors({});
    void useReplayStore.getState().openRun(
      paneId,
      sessionId,
      selectedRunId,
      (afterSeq, signal) => listReplayEvents(apiBase, apiToken, selectedRunId, {
        afterSeq,
        limit: 100,
        includePayload: false,
        signal,
      }),
    );
  }, [apiBase, apiToken, paneId, selectedRunBelongsToSession, selectedRunId, sessionId]);

  const effectiveReplay = replay ?? useReplayStore.getState().getPane(paneId);
  const sessionRuns = runs.filter((run) => run.sessionId === sessionId);
  const listedSelectedRun = sessionRuns.find((run) => run.runId === selectedRunId);
  const selectedRun = effectiveReplay.run?.runId === selectedRunId
    && effectiveReplay.run.sessionId === sessionId
    ? effectiveReplay.run
    : listedSelectedRun ?? null;

  useEffect(() => {
    if (
      selectedRun?.status !== "running"
      || selectedRun.sessionId !== sessionId
      || !selectedRunId
      || !apiBase
    ) return;
    let pending = false;
    const controller = new AbortController();
    const poll = () => {
      if (pending) return;
      pending = true;
      const afterSeq = useReplayStore.getState().getPane(paneId).nextSeq;
      void listReplayEvents(apiBase, apiToken, selectedRunId, {
        afterSeq,
        limit: 100,
        includePayload: false,
        signal: controller.signal,
      }).then((page) => {
        useReplayStore.getState().setError(paneId, null);
        useReplayStore.getState().appendPage(paneId, page);
        setRuns((current) => current.map((run) => run.runId === page.run.runId ? page.run : run));
      }).catch((error: unknown) => {
        if (!isAbortError(error)) {
          useReplayStore.getState().setError(
            paneId,
            error instanceof Error ? error.message : String(error),
          );
        }
      }).finally(() => {
        pending = false;
      });
    };
    const timer = setInterval(poll, 2_000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [apiBase, apiToken, paneId, selectedRun?.sessionId, selectedRun?.status, selectedRunId, sessionId]);

  useEffect(() => {
    if (!selectedRun || effectiveReplay.runId !== selectedRun.runId) return;
    if (!shouldLoadAllReplayPages(
      selectedRun.status,
      effectiveReplay.hasMore,
      effectiveReplay.loading || Boolean(effectiveReplay.error),
    )) return;
    void useReplayStore.getState().loadAllPages(paneId);
  }, [
    effectiveReplay.error,
    effectiveReplay.hasMore,
    effectiveReplay.loading,
    effectiveReplay.runId,
    paneId,
    selectedRun?.runId,
    selectedRun?.status,
  ]);

  useEffect(() => () => {
    useReplayStore.getState().closeTab(paneId);
    for (const controller of auxiliaryControllers.current) controller.abort();
    auxiliaryControllers.current.clear();
    if (copyFeedbackTimer.current) clearTimeout(copyFeedbackTimer.current);
  }, [paneId]);

  useEffect(() => {
    setCopying(false);
    setCopyFeedback(null);
    setPayloadLoadingId(null);
    setPayloadErrors({});
    return () => {
      for (const controller of auxiliaryControllers.current) controller.abort();
      auxiliaryControllers.current.clear();
    };
  }, [selectedRunId, sessionId]);

  const projection = useMemo(
    () => projectReplay(effectiveReplay.events, effectiveReplay.filters),
    [effectiveReplay.events, effectiveReplay.filters],
  );
  const cursorVisibleEvents = useMemo(
    () => projection.visibleEvents.filter((event) => event.seq <= effectiveReplay.cursorSeq),
    [effectiveReplay.cursorSeq, projection.visibleEvents],
  );
  const selectedEvent = effectiveReplay.events.find(
    (event) => event.eventId === effectiveReplay.selectedEventId,
  ) ?? null;
  const selectedChain = useMemo(() => {
    if (!selectedEvent) return null;
    return buildCausalChain(effectiveReplay.events, selectedEvent.eventId);
  }, [effectiveReplay.events, selectedEvent]);
  const chainEventIds = selectedChain && selectedChain.eventIds.length > 0
    ? new Set(selectedChain.eventIds)
    : undefined;
  const inferredToEventIds = selectedChain
    ? new Set(
      selectedChain.hops
        .filter((hop) => hop.kind === "inferred")
        .map((hop) => hop.toEventId),
    )
    : undefined;

  useEffect(() => {
    const targetKey = focusTarget
      ? `${sessionId}:${focusTarget.runId}:${focusTarget.eventId}`
      : null;
    if (
      !targetKey
      || appliedTarget.current === targetKey
      || locatingTarget.current === targetKey
      || selectedRunId !== focusTarget?.runId
      || effectiveReplay.runId !== focusTarget.runId
      || effectiveReplay.loading
    ) return;
    locatingTarget.current = targetKey;
    let disposed = false;
    void (async () => {
      while (!disposed) {
        const state = useReplayStore.getState().getPane(paneId);
        const target = state.events.find(
          (event) => event.eventId === focusTarget.eventId,
        );
        if (target) {
          useReplayStore.getState().selectEvent(paneId, target.eventId);
          useReplayStore.getState().seek(paneId, target.seq);
          appliedTarget.current = targetKey;
          return;
        }
        if (!state.hasMore) {
          useReplayStore.getState().setError(
            paneId,
            t("replay.sourceEventUnavailable"),
          );
          appliedTarget.current = targetKey;
          return;
        }
        const before = `${state.nextSeq}:${state.events.length}`;
        await useReplayStore.getState().loadNextPage(paneId);
        const after = useReplayStore.getState().getPane(paneId);
        if (`${after.nextSeq}:${after.events.length}` === before) {
          return;
        }
      }
    })().finally(() => {
      if (locatingTarget.current === targetKey) locatingTarget.current = null;
    });
    return () => {
      disposed = true;
    };
  }, [
    effectiveReplay.loading,
    effectiveReplay.runId,
    focusTarget,
    paneId,
    selectedRunId,
    sessionId,
    t,
  ]);
  const branchAvailability = selectedEvent && selectedRun
    ? resolveBranchAvailability(selectedRun, effectiveReplay.events, selectedEvent)
    : { event: null, reason: "no_stable_checkpoint" };
  const resolvedBranchEvent = branchAvailability.event;
  const firstSeq = effectiveReplay.events[0]?.seq ?? 0;
  const lastSeq = effectiveReplay.events.at(-1)?.seq ?? firstSeq;
  const firstTs = effectiveReplay.events[0]?.ts ?? 0;
  const ledgerToolCallIds = useMemo(
    () => new Set(effectiveReplay.events.flatMap((event) => event.toolCallId ? [event.toolCallId] : [])),
    [effectiveReplay.events],
  );
  const hasUncommittedGraphSteps = Object.values(graphSteps).some(
    (steps) => steps.some((step) => !ledgerToolCallIds.has(step.callId)),
  );
  const summarizing = selectedRun !== null && TERMINAL_REPLAY_STATUSES.has(selectedRun.status) && (
    effectiveReplay.runId !== selectedRun.runId
    || effectiveReplay.loading
    || effectiveReplay.loadingMore
    || effectiveReplay.hasMore
  );

  const loadMore = useCallback(async () => {
    if (!selectedRunId || effectiveReplay.loadingMore) return;
    await useReplayStore.getState().loadNextPage(paneId);
  }, [
    effectiveReplay.loadingMore,
    paneId,
    selectedRunId,
  ]);

  const loadPayload = useCallback(async (event: ReplayEvent) => {
    if (effectiveReplay.payloadCache[event.eventId] || payloadLoadingId) return;
    const controller = new AbortController();
    auxiliaryControllers.current.add(controller);
    setPayloadLoadingId(event.eventId);
    setPayloadErrors((current) => setPayloadErrorForEvent(current, event.eventId, null));
    try {
      const page = await listReplayEvents(apiBase, apiToken, event.runId, {
        afterSeq: Math.max(0, event.seq - 1),
        limit: 1,
        includePayload: true,
        signal: controller.signal,
      });
      const resolved = page.events.find((row) => row.eventId === event.eventId);
      if (!resolved) throw new Error(t("replay.payloadLoadFailed"));
      useReplayStore.getState().cacheEventPayload(paneId, event.eventId, resolved.payload);
    } catch (error) {
      if (!isAbortError(error)) {
        setPayloadErrors((current) => setPayloadErrorForEvent(
          current,
          event.eventId,
          error instanceof Error ? error.message : String(error),
        ));
      }
    } finally {
      auxiliaryControllers.current.delete(controller);
      if (!controller.signal.aborted) setPayloadLoadingId(null);
    }
  }, [apiBase, apiToken, effectiveReplay.payloadCache, paneId, payloadLoadingId, t]);

  const copyReview = useCallback(async () => {
    if (!selectedRunId || copying) return;
    setCopying(true);
    setCopyFeedback(null);
    if (copyFeedbackTimer.current) clearTimeout(copyFeedbackTimer.current);
    const controller = new AbortController();
    auxiliaryControllers.current.add(controller);
    try {
      await copyReplayReview(
        apiBase,
        apiToken,
        selectedRunId,
        (markdown) => navigator.clipboard.writeText(markdown),
        controller.signal,
      );
      setCopyFeedback(t("replay.copiedReview"));
      copyFeedbackTimer.current = setTimeout(() => setCopyFeedback(null), 1_600);
    } catch (error) {
      if (!isAbortError(error)) {
        setCopyFeedback(
          `${t("replay.copyFailed")}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } finally {
      auxiliaryControllers.current.delete(controller);
      if (!controller.signal.aborted) setCopying(false);
    }
  }, [apiBase, apiToken, copying, selectedRunId, t]);

  if (!sessionId) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-5 text-center">
        <p className="text-[12px] text-text-muted">{t("replay.sendFirst")}</p>
        <p className="mt-1 max-w-[300px] text-[10px] leading-relaxed text-text-faint">
          {t("replay.sendFirstHint")}
        </p>
      </div>
    );
  }
  if (listLoading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-[11px] text-text-faint">
        <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />
        {t("replay.loading")}
      </div>
    );
  }
  if (listError) {
    return (
      <div className="flex h-full items-center justify-center px-5">
        <div className="max-w-md rounded-md bg-status-error/10 px-3 py-2 text-[11px] text-status-error">
          {t("replay.loadFailed")}: {listError}
        </div>
      </div>
    );
  }
  if (!selectedRun && sessionRuns.length === 0) {
    if (hasGraphSteps) {
      return (
        <ExecutionTimeline
          paneId={paneId}
          agentIds={agentIds}
          avatarById={avatarById}
          metaLeaderLabel={metaLeaderLabel}
        />
      );
    }
    return (
      <div className="flex h-full flex-col items-center justify-center px-5 text-center">
        <p className="text-[12px] text-text-muted">{legacy ? t("replay.legacy") : t("replay.noRuns")}</p>
        {legacy ? (
          <p className="mt-1 max-w-[320px] text-[10px] leading-relaxed text-text-faint">
            {t("replay.legacyHint")}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-panel">
      {selectedRun ? (
        <ReplaySummaryBar
          runs={sessionRuns}
          selectedRunId={selectedRun.runId}
          stats={{
            ...projection.stats,
            branches: selectedRun.branchCount ?? projection.stats.branches,
          }}
          summarizing={summarizing}
          onSelectRun={(runId) => {
            useReplayStore.getState().resetPane(paneId);
            setSelectedRunId(runId);
          }}
        />
      ) : null}
      <ReplayControls
        playing={effectiveReplay.playing}
        speed={effectiveReplay.speed}
        filters={effectiveReplay.filters}
        canStepBack={effectiveReplay.cursorSeq > firstSeq}
        canStepForward={effectiveReplay.cursorSeq < lastSeq}
        copying={copying}
        copyFeedback={copyFeedback}
        onTogglePlay={() => {
          if (effectiveReplay.playing) useReplayStore.getState().pause(paneId);
          else useReplayStore.getState().play(paneId);
        }}
        onStep={(direction) => useReplayStore.getState().step(paneId, direction)}
        onSpeedChange={(speed) => useReplayStore.getState().setSpeed(paneId, speed)}
        onFiltersChange={(filters) => useReplayStore.getState().setFilters(paneId, filters)}
        onCopy={() => void copyReview()}
      />
      {effectiveReplay.error ? (
        <div className="mx-3 mt-2 flex items-start gap-1.5 rounded-md bg-status-error/10 px-2 py-1.5 text-[10px] text-status-error">
          <AlertTriangle aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="break-words">{effectiveReplay.error}</span>
        </div>
      ) : null}
      {effectiveReplay.parseWarnings.length > 0 ? (
        <div className="mx-3 mt-2 rounded-md bg-status-warning/10 px-2 py-1.5 text-[10px] text-status-warning">
          {t("replay.parseWarning")}
        </div>
      ) : null}
      {selectedRun?.status === "running" && hasUncommittedGraphSteps ? (
        <div className="max-h-[38%] min-h-[140px] border-b border-border">
          <div className="border-b border-border px-3 py-1 text-[9px] uppercase tracking-wide text-text-faint">
            {t("replay.liveOverlay")}
          </div>
          <ExecutionTimeline
            paneId={paneId}
            agentIds={agentIds}
            avatarById={avatarById}
            metaLeaderLabel={metaLeaderLabel}
            excludeCallIds={ledgerToolCallIds}
          />
        </div>
      ) : null}
      {effectiveReplay.loading ? (
        <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-[11px] text-text-faint">
          <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />
          {t("replay.loading")}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <ReplayTimeline
            events={cursorVisibleEvents}
            renderLimit={effectiveReplay.renderLimit}
            rangeFirstSeq={firstSeq}
            rangeLastSeq={lastSeq}
            rangeFirstTs={firstTs}
            cursorSeq={effectiveReplay.cursorSeq}
            selectedEventId={effectiveReplay.selectedEventId}
            avatarById={avatarById}
            metaLeaderLabel={metaLeaderLabel}
            onSeek={(seq) => useReplayStore.getState().seek(paneId, seq)}
            onSelect={(eventId) => useReplayStore.getState().selectEvent(paneId, eventId)}
            onTogglePlay={() => {
              if (effectiveReplay.playing) useReplayStore.getState().pause(paneId);
              else useReplayStore.getState().play(paneId);
            }}
            onStep={(direction) => useReplayStore.getState().step(paneId, direction)}
            onShowMore={() => useReplayStore.getState().showMoreEvents(paneId)}
            chainEventIds={chainEventIds}
            inferredToEventIds={inferredToEventIds}
          />
          <ReplayEventDetail
            event={selectedEvent}
            payloadDisplay={selectedEvent
              ? effectiveReplay.payloadCache[selectedEvent.eventId]
              : undefined}
            payloadLoading={selectedEvent?.eventId === payloadLoadingId}
            payloadError={payloadErrorForEvent(payloadErrors, selectedEvent?.eventId)}
            onLoadPayload={(event) => void loadPayload(event)}
            onOpenArtifact={onOpenArtifact}
            onOpenSubagentRun={onOpenSubagentRun}
            canBranch={Boolean(
              selectedRun && resolvedBranchEvent,
            )}
            branchDisabledReason={branchAvailability.reason ?? undefined}
            onBranchFromStep={(event) => {
              setBranchError(null);
              setBranchStage("validate");
              setBranchEvent(event);
            }}
            chain={selectedChain}
            chainEvents={effectiveReplay.events}
            onCopyChain={(markdown) => navigator.clipboard.writeText(markdown)}
            onSelectChainEvent={(eventId) => {
              useReplayStore.getState().selectEvent(paneId, eventId);
            }}
          />
        </div>
      )}
      {effectiveReplay.hasMore ? (
        <div className="shrink-0 border-t border-border px-3 py-2 text-center">
          <button
            type="button"
            className="rounded-md bg-surface-hover px-3 py-1 text-[10px] text-text-muted hover:bg-surface-card-strong hover:text-text-strong disabled:opacity-50"
            disabled={effectiveReplay.loadingMore}
            onClick={() => void loadMore()}
          >
            {effectiveReplay.loadingMore ? t("replay.loadingMore") : t("replay.loadMore")}
          </button>
        </div>
      ) : null}
      <BranchFromStepDialog
        open={branchEvent !== null}
        requestedSeq={branchEvent?.seq ?? 0}
        resolvedSeq={branchEvent
          ? resolveBranchPreview(effectiveReplay.events, branchEvent)?.seq ?? 0
          : 0}
        skippedToolCount={branchEvent
          ? effectiveReplay.events.filter(
            (event) => event.type === "tool_call" && event.seq < branchEvent.seq,
          ).length
          : 0}
        workspaceStatus={branchEvent
          ? resolveBranchPreview(effectiveReplay.events, branchEvent)?.unbranchableReason
            ?? "git_isolate_ready"
          : ""}
        warnings={(branchEvent
          ? effectiveReplay.events
            .filter((event) => (
              event.type === "tool_call"
              && event.seq <= (
                resolveBranchPreview(effectiveReplay.events, branchEvent)?.seq ?? 0
              )
              && (
                event.effectClass === "external_write"
                || event.effectClass === "unknown"
              )
            ))
            .reduce<BranchEffectWarning[]>((warnings, event) => {
              const toolName = event.title || "unknown_tool";
              const current = warnings.find(
                (warning) => warning.effectClass === event.effectClass
                  && warning.toolName === toolName,
              );
              if (current) current.count += 1;
              else warnings.push({
                effectClass: event.effectClass as BranchEffectWarning["effectClass"],
                toolName,
                count: 1,
              });
              return warnings;
            }, [])
          : [])}
        submitting={branchSubmitting}
        stage={branchStage}
        error={branchError}
        onCancel={() => {
          if (!branchSubmitting) setBranchEvent(null);
        }}
        onSubmit={async ({ instruction, provider, model }) => {
          if (!branchEvent || !selectedRun) return;
          const localPreview = resolveBranchAvailability(
            selectedRun,
            effectiveReplay.events,
            branchEvent,
          );
          if (!localPreview.event) {
            setBranchError({
              code: localPreview.reason ?? "no_stable_checkpoint",
              detail: t(`replay.branchReason.${localPreview.reason ?? "no_stable_checkpoint"}`),
            });
            setBranchStage("validate");
            return;
          }
          setBranchSubmitting(true);
          setBranchError(null);
          setBranchStage("restore");
          try {
            const result = await createRunBranch(
              apiBase,
              apiToken,
              selectedRun.runId,
              {
                sourceEventId: branchEvent.eventId,
                instruction,
                provider,
                model,
              },
            );
            setBranchStage("open_session");
            const store = useAppStore.getState();
            const sourcePane = store.panes.find((pane) => pane.id === paneId);
            const newPaneId = store.addPane(
              sourcePane?.avatarId ?? null,
              sourcePane?.avatarName ?? metaLeaderLabel,
              result.sessionId,
            );
            if (result.provider && result.model) {
              store.setPaneModel(newPaneId, result.provider, result.model);
            }
            store.setActivePaneId(newPaneId);
            setBranchStage("send_instruction");
            await sendTextToPane(newPaneId, result.instruction);
            setBranchEvent(null);
          } catch (error) {
            setBranchError(
              error instanceof RunBranchRequestError
                ? {
                    code: error.code,
                    detail: t(`replay.branchReason.${error.code.replaceAll(":", "_")}`, {
                      defaultValue: error.message,
                    }),
                  }
                : {
                    code: "branch_create_failed",
                    detail: error instanceof Error ? error.message : String(error),
                  },
            );
          } finally {
            setBranchSubmitting(false);
            setBranchStage("validate");
          }
        }}
      />
    </div>
  );
}
