import type { ComprehensionGateStatus, SessionPhase } from "../../modules/tutoring/tutor-action.js";
import { isGateComplete } from "../../modules/tutoring/phase-policy.js";

/**
 * The phase rail (the "Spine") collapses the canonical ten phases into the four
 * friendly stations the child sees (the locked mockup's Warm-up · Understand ·
 * Work it out · Wrap). The exhaustive grouping below is the source of that map.
 */
export type RailStationState = "done" | "active" | "next";

export type RailStation = {
  label: string;
  state: RailStationState;
};

const stationLabels = ["Warm-up", "Understand", "Work it out", "Wrap"] as const;

// Exhaustive so adding a phase to the contract is a compile error until it is placed.
const stationGroupByPhase: Record<SessionPhase, number> = {
  session_open: 0,
  capture_parse: 1,
  frame_task: 1,
  activate_prior: 1,
  plan_first_step: 2,
  step_loop: 2,
  answer_check: 2,
  memory_write: 3,
  transfer_check: 3,
  wrap_up: 3
};

export function railStations(
  currentPhase: SessionPhase,
  gateStatus: ComprehensionGateStatus | null = null
): RailStation[] {
  let activeGroup = stationGroupByPhase[currentPhase];

  if (currentPhase === "frame_task" && isGateComplete(gateStatus)) {
    activeGroup = 2;
  }

  return stationLabels.map((label, index) => ({
    label,
    state: index < activeGroup ? "done" : index === activeGroup ? "active" : "next"
  }));
}
