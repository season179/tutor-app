import { useEffect, useState } from "react";

import { sessionPhases, type ComprehensionGateStatus, type SessionPhase, type SupportLevel } from "../../tutor-action.js";
import type { VoicePipelineSessionState } from "../../voice-types.js";
import { getSession } from "../lib/session-api.js";
import { toTranscriptTurns, type TranscriptTurn } from "../lib/transcript.js";

const initialPhase: SessionPhase = sessionPhases[0];

type UseLiveSessionOptions = {
  activeSessionId: string | undefined;
  eventCount: number;
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
 */
type LiveSessionView = {
  currentPhase: SessionPhase;
  focusAsk: string | null;
  gateStatus: ComprehensionGateStatus | null;
  scaffoldAid: string | null;
  supportLevel: SupportLevel;
  turns: TranscriptTurn[];
  unknownTarget: string | null;
};

const emptyView: LiveSessionView = {
  currentPhase: initialPhase,
  focusAsk: null,
  gateStatus: null,
  scaffoldAid: null,
  supportLevel: 0,
  turns: [],
  unknownTarget: null
};

export function useLiveSession({
  activeSessionId,
  eventCount,
  ready,
  turnSessionState = null
}: UseLiveSessionOptions): LiveSessionView {
  const [view, setView] = useState<LiveSessionView>(emptyView);

  useEffect(() => {
    setView(emptyView);
  }, [activeSessionId]);

  useEffect(() => {
    if (!ready || !activeSessionId) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const detail = await getSession(activeSessionId);
        if (cancelled) {
          return;
        }

        setView({
          currentPhase: detail.session.currentPhase,
          focusAsk: detail.session.activeStep?.ask ?? null,
          gateStatus: detail.session.gateStatus,
          scaffoldAid: detail.session.activeStep?.scaffoldAid ?? null,
          supportLevel: detail.session.supportLevel,
          turns: toTranscriptTurns(detail.events),
          unknownTarget: detail.problemContext?.unknownTarget ?? null
        });
      } catch {
        // Leave the last-known view in place; the event log surfaces failures.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeSessionId, eventCount, ready]);

  useEffect(() => {
    if (!turnSessionState) {
      return;
    }

    setView((current) => ({
      ...current,
      currentPhase: turnSessionState.currentPhase,
      focusAsk: turnSessionState.focusAsk,
      gateStatus: turnSessionState.gateStatus,
      scaffoldAid: turnSessionState.scaffoldAid,
      supportLevel: turnSessionState.supportLevel,
      unknownTarget: turnSessionState.unknownTarget
    }));
  }, [turnSessionState]);

  return view;
}
