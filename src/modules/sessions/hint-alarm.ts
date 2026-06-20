import type { SessionStore } from "./session-store.js";
import { hintNudgeForSupportLevel, hintTimerEventMessage, hintWaitMs, shouldArmHintTimer } from "./hint-timer.js";

export type IdleHintAlarmResult = {
  /** Whether an idle nudge was appended this firing. */
  nudged: boolean;
  /** When to re-arm the alarm, or null to leave it disarmed. */
  rearmAtMs: number | null;
};

/**
 * The idle-hint alarm body, extracted from the Durable Object so the load-bearing decision can
 * be exercised without the Workers runtime: only nudge while the session is still in the step
 * loop, build the nudge from the live (answer-free) step, append it, and ask to re-arm. A child
 * who has moved on (or whose session is gone) gets no nudge and the alarm is left disarmed.
 */
export async function runIdleHintAlarm(
  store: SessionStore,
  ownerKey: string,
  sessionId: string,
  nowMs: number
): Promise<IdleHintAlarmResult> {
  const detail = await store.getSession(ownerKey, sessionId);

  if (!detail || !shouldArmHintTimer(detail.session.currentPhase)) {
    return { nudged: false, rearmAtMs: null };
  }

  await store.appendEvent(ownerKey, sessionId, {
    message: hintTimerEventMessage,
    value: {
      kind: "idle_nudge",
      supportLevel: detail.session.supportLevel,
      // Derive the nudge from the live step (answer-free fields only), not a fixed script.
      text: hintNudgeForSupportLevel(detail.session.supportLevel, {
        ask: detail.session.activeStep?.ask ?? null,
        scaffoldAid: detail.session.activeStep?.scaffoldAid ?? null
      })
    }
  });

  return { nudged: true, rearmAtMs: nowMs + hintWaitMs };
}
