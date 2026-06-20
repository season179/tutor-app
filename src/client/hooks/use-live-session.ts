import { useEffect, useState } from "react";

import { useQuery } from "@tanstack/react-query";

import {
  goalStatusFromDetail,
  outputLanguageLabelFromContext,
  pendingHintFromEvents
} from "../../modules/sessions/live-session-projection.js";
import type { PublicTutorSessionDetail } from "../../modules/sessions/session-types.js";
import { sessionPhases, type ComprehensionGateStatus, type SessionPhase, type SupportLevel } from "../../modules/tutoring/tutor-action.js";
import type { VoicePipelineSessionState } from "../../modules/voice/voice-types.js";
import { getSession } from "../lib/session-api.js";
import { toTranscriptTurns, type TranscriptTurn } from "../lib/transcript.js";

const initialPhase: SessionPhase = sessionPhases[0];

type UseLiveSessionOptions = {
  activeSessionId: string | undefined;
  eventCount: number;
  isRunning?: boolean;
  ready: boolean;
  turnSessionState?: VoicePipelineSessionState | null;
};

/**
 * The center column's read model. The server owns the phase and the canonical
 * event log, so this hook treats the server as the source of truth: whenever the
 * active session changes or a new event is logged (the `eventCount` pulse), it
 * re-fetches the session detail and projects it into the authoritative phase and
 * transcript the surface renders. A fresh turn response can patch phase/gate/chip
 * state immediately so the target chip lights in the same turn.
 *
 * TanStack Query owns the fetch: `["session", id, eventCount]` re-fetches on the
 * event pulse, `refetchInterval` drives the 15s idle poll, and query keying gives
 * the stale-response cancellation the manual `cancelled` flag used to provide. The
 * `view` state is synced from query data so the turn-response overlay still merges
 * on top of the latest server projection.
 */
type LiveSessionView = {
  currentPhase: SessionPhase;
  focusAsk: string | null;
  gateStatus: ComprehensionGateStatus | null;
  goalStatus: VoicePipelineSessionState["goalStatus"];
  outputLanguageLabel: string | null;
  pendingHint: string | null;
  scaffoldAid: string | null;
  supportLevel: SupportLevel;
  turns: TranscriptTurn[];
  unknownTarget: string | null;
};

const emptyView: LiveSessionView = {
  currentPhase: initialPhase,
  focusAsk: null,
  gateStatus: null,
  goalStatus: "empty",
  outputLanguageLabel: null,
  pendingHint: null,
  scaffoldAid: null,
  supportLevel: 0,
  turns: [],
  unknownTarget: null
};

function projectView(detail: PublicTutorSessionDetail): LiveSessionView {
  return {
    currentPhase: detail.session.currentPhase,
    focusAsk: detail.session.activeStep?.ask ?? null,
    gateStatus: detail.session.gateStatus,
    goalStatus: goalStatusFromDetail({
      events: detail.events,
      gateStatus: detail.session.gateStatus,
      phase: detail.session.currentPhase,
      reflectionPresent: Boolean(detail.reflection)
    }),
    outputLanguageLabel: outputLanguageLabelFromContext(detail.problemContext),
    pendingHint: pendingHintFromEvents(detail.events),
    scaffoldAid: detail.session.activeStep?.scaffoldAid ?? null,
    supportLevel: detail.session.supportLevel,
    turns: toTranscriptTurns(detail.events),
    unknownTarget: detail.problemContext?.unknownTarget ?? null
  };
}

export function useLiveSession({
  activeSessionId,
  eventCount,
  isRunning = false,
  ready,
  turnSessionState = null
}: UseLiveSessionOptions): LiveSessionView {
  const [view, setView] = useState<LiveSessionView>(emptyView);

  useEffect(() => {
    setView(emptyView);
  }, [activeSessionId]);

  const enabled = ready && Boolean(activeSessionId);

  const sessionQuery = useQuery({
    queryKey: ["session", activeSessionId, eventCount],
    queryFn: () => getSession(activeSessionId!),
    enabled,
    // Idle poll only while a run sits in the step loop, matching the old interval
    // guard. `view.currentPhase` is re-read each render, so a turn-response patch
    // that moves out of `step_loop` stops the poll on the next render.
    refetchInterval: isRunning && view.currentPhase === "step_loop" ? 15_000 : false
  });

  // The server is the source of truth: a successful fetch replaces the view,
  // discarding any prior turn-response patch.
  useEffect(() => {
    if (!sessionQuery.data) {
      return;
    }

    setView(projectView(sessionQuery.data));
  }, [sessionQuery.data]);

  useEffect(() => {
    if (!turnSessionState) {
      return;
    }

    setView((current) => ({
      ...current,
      currentPhase: turnSessionState.currentPhase,
      focusAsk: turnSessionState.focusAsk,
      gateStatus: turnSessionState.gateStatus,
      goalStatus: turnSessionState.goalStatus,
      outputLanguageLabel: turnSessionState.outputLanguageLabel,
      pendingHint: turnSessionState.currentPhase === "step_loop" ? null : current.pendingHint,
      scaffoldAid: turnSessionState.scaffoldAid,
      supportLevel: turnSessionState.supportLevel,
      unknownTarget: turnSessionState.unknownTarget
    }));
  }, [turnSessionState]);

  return view;
}
