import { HttpError, type JsonValue } from "../../core/http-error.js";
import {
  extractOutputText,
  fetchOpenAiJson,
  openAiRequestTimeoutMs,
  requireOpenAiApiKey
} from "../../providers/openai/openai-responses.js";
import type { ReasoningEnv } from "../../providers/reasoning/reasoning-binding.js";
import { composeReasoningInput, runReasoningWorkflow } from "../../providers/reasoning/reasoning-binding.js";
import { outputLanguageLabel } from "../tutoring/answer-checker.js";
import { deriveFinalAnswerCheck, deriveFirstCheckableStep, type ActiveStep } from "../tutoring/active-step.js";
import { checkGateStage, type GateCheckerVerdict } from "../tutoring/gate-checker.js";
import { gradeStudentTurn } from "../tutoring/verifier.js";
import {
  allowedMoves,
  allowedNextPhases,
  canTransition,
  forbiddenMoves,
  gateStageForStatus,
  isGateReadStatus,
  nextGateStatus,
  type GateStage
} from "../tutoring/phase-policy.js";
import { scrubComputedSolutionFromText, type ProblemContextRecord } from "../problems/problem-frame.js";
import type { RequestContext } from "../../core/request-context.js";
import type { SessionStore } from "../sessions/session-store.js";
import {
  studentTurnEventMessage,
  toPublicActiveStep,
  tutorTurnEventMessage,
  type AppendSessionEventRequest,
  type TutorSessionDetail
} from "../sessions/session-types.js";
import type { StepVerifierVerdict } from "../tutoring/step-verifier.js";
import {
  gateForbiddenMoves,
  sessionPhases,
  tutorActionSchemaVersion,
  tutorMoves,
  type ProposedMove,
  type ProposedTutorAction,
  type SessionPhase,
  type ComprehensionGateStatus,
  type StudentAssessmentStatus,
  type SupportLevel
} from "../tutoring/tutor-action.js";
import { isJsonObject } from "../../core/schema-parser.js";
import { validateTutorAction } from "../tutoring/tutor-action-validator.js";
import { tutorPolicy } from "../tutoring/tutor-policy.js";
import {
  serializeVoicePipelineTurnResponse,
  parseVoicePipelineTurnRequest
} from "./voice-session-schema.js";
import type {
  LessonPhase,
  PublicLessonTurn,
  StudentStatus,
  VoicePipelineAudioInput,
  VoicePipelineAudioOutput,
  VoicePipelineSessionState,
  VoicePipelineTurnRequest,
  VoicePipelineTurnResponse,
  VoicePreparedImage
} from "./voice-types.js";

export const defaultTutorModel = "gpt-5.5";
export const defaultTranscribeModel = "gpt-4o-transcribe";
export const defaultTtsModel = "gpt-4o-mini-tts";
export const defaultTtsVoice = "marin";

const speechMimeType = "audio/mpeg";
// Cap on the TTS upstream error body read for the HttpError payload (the success body is
// binary and read in full via arrayBuffer). Mirrors the shared helper's response cap.
const maxOpenAiSpeechErrorBytes = 8_192;
// How many times the generator may be re-asked when its proposed turn fails the
// phase rules before we give up. The gate must never be talked past, so a turn that
// keeps proposing illegal moves fails rather than reaching TTS.
const maxTutorAttempts = 2;

export type VoicePipelineServiceEnv = ReasoningEnv & {
  OPENAI_API_KEY: string | undefined;
  OPENAI_GATE_CHECKER_MODEL?: string | undefined;
  OPENAI_TRANSCRIBE_MODEL: string | undefined;
  OPENAI_TTS_MODEL: string | undefined;
  OPENAI_TTS_VOICE: string | undefined;
  OPENAI_TUTOR_MODEL: string | undefined;
  OPENAI_VERIFIER_MODEL?: string | undefined;
};

type VoicePipelineOptions = {
  apiKey: string | undefined;
  transcribeModel: string;
  ttsModel: string;
  tutorModel: string;
  voice: string;
};

type TutorTurnInput = {
  activeStep: ActiveStep | null;
  detail: TutorSessionDetail;
  gateStatus: ComprehensionGateStatus | null;
  image: VoicePreparedImage | null;
  // True only for the tutor's opening turn (no student input yet); steers the move
  // generator to greet and orient rather than respond to a student answer.
  kickoff?: boolean;
  problemContext: ProblemContextRecord | null;
  stepVerifierVerdict: StepVerifierVerdict | null;
  studentText: string;
  supportLevel: SupportLevel;
};

export function createVoicePipelineOptions(env: VoicePipelineServiceEnv): VoicePipelineOptions {
  return {
    apiKey: env.OPENAI_API_KEY,
    transcribeModel: env.OPENAI_TRANSCRIBE_MODEL ?? defaultTranscribeModel,
    ttsModel: env.OPENAI_TTS_MODEL ?? defaultTtsModel,
    tutorModel: env.OPENAI_TUTOR_MODEL ?? defaultTutorModel,
    voice: env.OPENAI_TTS_VOICE ?? defaultTtsVoice
  };
}

export async function handleVoicePipelineTurnWithStore(
  body: unknown,
  env: VoicePipelineServiceEnv,
  store: SessionStore,
  requestContext: RequestContext
): Promise<VoicePipelineTurnResponse> {
  const request = parseVoicePipelineTurnRequest(body);
  const detail = await store.getSession(requestContext.ownerKey, request.sessionId);

  if (!detail) {
    throw new HttpError(404, "Session not found");
  }

  const options = createVoicePipelineOptions(env);

  // The tutor's opening turn: it speaks first, before the student says anything. Skip the
  // student-text/gate/grader machinery and just produce the first move from the confirmed
  // problem. Branches early because none of the per-student-turn artifacts apply.
  if (request.kickoff) {
    return handleKickoffTurn(detail, request.sessionId, options, env, store, requestContext.ownerKey);
  }

  const studentText = await readStudentText(request, options);
  const fromPhase = detail.session.currentPhase;
  let gateStatus = detail.session.gateStatus;
  // getSession already loaded the problem context for this session — reuse it instead of a
  // second store round-trip.
  const problemContext = detail.problemContext;

  let gateVerdict: GateCheckerVerdict | null = null;
  let gateStageChecked: GateStage | null = null;
  if (shouldEvaluateGateStage(fromPhase, gateStatus, studentText, problemContext)) {
    gateStageChecked = gateStageForStatus(gateStatus);
    if (gateStageChecked) {
      gateVerdict = await checkGateStage(gateStageChecked, problemContext, studentText, env);
      if (gateVerdict.accepted) {
        // Advance exactly one read; only the final restatement flips the gate to complete.
        gateStatus = nextGateStatus(gateStatus);
      }
    }
  }

  let activeStep = detail.session.activeStep;
  if (!activeStep && shouldSeedActiveStep(fromPhase, gateStatus, problemContext)) {
    activeStep = seedActiveStepForPhase(fromPhase, problemContext!);
  }

  const checkerVerdict = await gradeStudentTurn(
    {
      activeStep,
      frame: problemContext,
      gateStatus,
      lastTutorAsk: latestTutorAsk(detail),
      phase: fromPhase,
      studentText
    },
    env
  );

  const supportLevel = nextSupportLevel(detail.session.supportLevel, checkerVerdict, studentText);

  const action = await proposeTutorAction(
    {
      activeStep,
      detail,
      gateStatus,
      image: request.image ?? null,
      problemContext,
      stepVerifierVerdict: checkerVerdict,
      studentText,
      supportLevel
    },
    env
  );

  const audio = await createTutorSpeech(action.spokenUtterance, options);
  const publicLesson = projectToPublicLesson(action, checkerVerdict);
  let toPhase = nextPhaseFor(fromPhase, action, gateStatus);
  ({ activeStep, toPhase } = applyServerPhaseOverrides({
    activeStep,
    checkerVerdict,
    fromPhase,
    gateStatus,
    problemContext,
    studentText,
    toPhase
  }));

  const sessionState = buildSessionState({
    activeStep,
    checkerVerdict,
    fromPhase,
    gateStatus,
    phase: toPhase,
    problemContext,
    supportLevel
  });
  const response = serializeVoicePipelineTurnResponse({
    audio,
    lesson: publicLesson,
    session: sessionState,
    transcript: studentText,
    tutorText: action.spokenUtterance
  });

  // Everything this turn writes, assembled in log order so it can be committed as one unit.
  const turnEvents: AppendSessionEventRequest[] = [
    {
      message: request.image && !request.audio ? "Problem image submitted" : studentTurnEventMessage,
      value: {
        hasAudio: Boolean(request.audio),
        hasImage: Boolean(request.image),
        text: studentText
      }
    }
  ];
  if (gateVerdict && gateStageChecked) {
    turnEvents.push({
      message: "Gate check",
      value: {
        accepted: gateVerdict.accepted,
        checkKind: gateStageChecked,
        notes: gateVerdict.notes,
        studentText
      }
    });
  }
  if (checkerVerdict) {
    turnEvents.push({
      message: fromPhase === "answer_check" ? "Answer check" : "Step verify",
      value: {
        chip: checkerVerdict.chip,
        chipLabel: checkerVerdict.chipLabel,
        confidence: checkerVerdict.confidence,
        correctionHint: checkerVerdict.correctionHint,
        method: checkerVerdict.method,
        misconceptionKey: checkerVerdict.misconceptionKey,
        studentAnswer: checkerVerdict.studentAnswer,
        studentStatus: checkerVerdict.studentStatus,
        studentText
      }
    });
  }
  turnEvents.push({
    message: tutorTurnEventMessage,
    value: {
      // Stamp the contract version so a persisted turn can be read back against the
      // schema it was written under as the TutorAction shape evolves across milestones.
      schemaVersion: tutorActionSchemaVersion,
      lesson: publicLesson,
      move: action.move,
      phase: fromPhase,
      nextPhase: toPhase,
      // The server-owned gate status this turn advanced to (statePatch.gateStatus),
      // recorded alongside the move so the audit trail carries the gate state, not just the phase.
      gateStatus,
      text: action.spokenUtterance,
      verdict:
        checkerVerdict === null
          ? null
          : {
              chip: checkerVerdict.chip,
              label: checkerVerdict.chipLabel,
              studentStatus: checkerVerdict.studentStatus,
              misconceptionKey: checkerVerdict.misconceptionKey
            }
    }
  });

  // Commit the advance, the draft→active flip, the events, the comprehension check, and any
  // reflection as one atomic unit, guarded by an optimistic lock on the phase we read. A null
  // result means a concurrent turn already moved the session off `fromPhase`, so this turn is
  // stale and nothing was written: bail rather than speaking over the turn that won the race.
  const committed = await store.commitTurn(requestContext.ownerKey, request.sessionId, {
    activate: detail.session.status !== "active",
    advance: { activeStep, currentPhase: toPhase, gateStatus, supportLevel },
    comprehensionCheck:
      gateVerdict && gateStageChecked
        ? { accepted: gateVerdict.accepted, checkKind: gateStageChecked, studentResponse: studentText }
        : null,
    events: turnEvents,
    expectedPhase: fromPhase,
    reflection: fromPhase === "memory_write" && studentText.trim() ? { reflectionText: studentText } : null
  });
  if (!committed) {
    throw new HttpError(409, "This session was advanced by another turn. Please retry.");
  }

  return response;
}

/**
 * The tutor's opening turn. Produces the first move (a greeting that orients to the
 * confirmed problem) with no student input: no transcription, gate check, or grading,
 * and the transcript records only the tutor turn. The session must still be at
 * `session_open`, so an already-started session can't be re-opened (the optimistic phase
 * lock on commit also blocks a concurrent double-open).
 */
async function handleKickoffTurn(
  detail: TutorSessionDetail,
  sessionId: string,
  options: VoicePipelineOptions,
  env: VoicePipelineServiceEnv,
  store: SessionStore,
  ownerKey: string
): Promise<VoicePipelineTurnResponse> {
  const fromPhase = detail.session.currentPhase;
  if (fromPhase !== "session_open") {
    throw new HttpError(409, "This tutoring session has already started.");
  }

  const gateStatus = detail.session.gateStatus;
  const problemContext = detail.problemContext;
  const supportLevel = detail.session.supportLevel;
  const activeStep = detail.session.activeStep;

  const action = await proposeTutorAction(
    {
      activeStep,
      detail,
      gateStatus,
      image: null,
      kickoff: true,
      problemContext,
      stepVerifierVerdict: null,
      studentText: "",
      supportLevel
    },
    env
  );

  const audio = await createTutorSpeech(action.spokenUtterance, options);
  const publicLesson = projectToPublicLesson(action, null);
  // No server phase overrides apply at session_open (they all key off step_loop/answer_check/
  // memory_write), so the proposed nextPhase is the only advance to honour.
  let toPhase = nextPhaseFor(fromPhase, action, gateStatus);
  // The kickoff's whole purpose is to advance into the Three Reads flow. If the model
  // proposes staying at session_open (a legal self-transition), the phase guard above would
  // pass on a *second* kickoff and the tutor would greet again — so force it forward to the
  // first real frame. This keeps the "an already-started session can't be re-opened"
  // invariant honest rather than relying on the model to leave session_open.
  if (toPhase === "session_open") {
    toPhase = "frame_task";
  }

  const sessionState = buildSessionState({
    activeStep,
    checkerVerdict: null,
    fromPhase,
    gateStatus,
    phase: toPhase,
    problemContext,
    supportLevel
  });
  const response = serializeVoicePipelineTurnResponse({
    audio,
    lesson: publicLesson,
    session: sessionState,
    transcript: "",
    tutorText: action.spokenUtterance
  });

  const committed = await store.commitTurn(ownerKey, sessionId, {
    activate: detail.session.status !== "active",
    advance: { activeStep, currentPhase: toPhase, gateStatus, supportLevel },
    comprehensionCheck: null,
    events: [
      {
        message: tutorTurnEventMessage,
        value: {
          schemaVersion: tutorActionSchemaVersion,
          lesson: publicLesson,
          move: action.move,
          phase: fromPhase,
          nextPhase: toPhase,
          gateStatus,
          text: action.spokenUtterance,
          verdict: null
        }
      }
    ],
    expectedPhase: fromPhase,
    reflection: null
  });
  if (!committed) {
    throw new HttpError(409, "This session was advanced by another turn. Please retry.");
  }

  return response;
}

function shouldSeedActiveStep(
  phase: SessionPhase,
  gateStatus: ComprehensionGateStatus | null,
  problemContext: ProblemContextRecord | null
): problemContext is ProblemContextRecord {
  return (
    (phase === "plan_first_step" || phase === "step_loop" || phase === "answer_check") &&
    gateStatus === "complete" &&
    Boolean(problemContext)
  );
}

function seedActiveStepForPhase(phase: SessionPhase, frame: ProblemContextRecord): ActiveStep | null {
  if (phase === "answer_check") {
    return deriveFinalAnswerCheck(frame);
  }

  return deriveFirstCheckableStep(frame);
}

/** The text of the most recent tutor turn — what the child is answering this turn. */
function latestTutorAsk(detail: TutorSessionDetail): string | null {
  for (const event of detail.events) {
    if (event.message !== tutorTurnEventMessage) {
      continue;
    }

    const value = event.value;
    if (value && typeof value === "object" && typeof (value as { text?: unknown }).text === "string") {
      return (value as { text: string }).text;
    }
  }

  return null;
}

function applyServerPhaseOverrides(input: {
  activeStep: ActiveStep | null;
  checkerVerdict: StepVerifierVerdict | null;
  fromPhase: SessionPhase;
  gateStatus: ComprehensionGateStatus | null;
  problemContext: ProblemContextRecord | null;
  studentText: string;
  toPhase: SessionPhase;
}): { activeStep: ActiveStep | null; toPhase: SessionPhase } {
  let { activeStep, toPhase } = input;

  if (
    input.fromPhase === "step_loop" &&
    input.checkerVerdict?.studentStatus === "correct" &&
    input.problemContext &&
    canTransition("step_loop", "answer_check", input.gateStatus)
  ) {
    activeStep = deriveFinalAnswerCheck(input.problemContext);
    toPhase = "answer_check";
  }

  if (
    input.fromPhase === "answer_check" &&
    input.checkerVerdict?.studentStatus === "correct" &&
    canTransition("answer_check", "memory_write", input.gateStatus)
  ) {
    activeStep = null;
    toPhase = "memory_write";
  }

  if (input.fromPhase === "memory_write" && input.studentText.trim() && canTransition("memory_write", "wrap_up")) {
    activeStep = null;
    toPhase = "wrap_up";
  }

  return { activeStep, toPhase };
}

function nextSupportLevel(
  current: SupportLevel,
  verdict: StepVerifierVerdict | null,
  studentText: string
): SupportLevel {
  if (!verdict) {
    return current;
  }

  if (verdict.studentStatus === "correct" && studentText.trim().split(/\s+/).length >= 4) {
    return Math.max(0, current - 1) as SupportLevel;
  }

  if (
    verdict.studentStatus === "incorrect" ||
    verdict.studentStatus === "partial" ||
    verdict.studentStatus === "stuck"
  ) {
    return Math.min(4, current + 1) as SupportLevel;
  }

  return current;
}

function buildSessionState(input: {
  activeStep: ActiveStep | null;
  checkerVerdict: StepVerifierVerdict | null;
  fromPhase: SessionPhase;
  gateStatus: ComprehensionGateStatus | null;
  phase: SessionPhase;
  problemContext: ProblemContextRecord | null;
  supportLevel: SupportLevel;
}): VoicePipelineSessionState {
  const focusAsk =
    input.phase === "memory_write"
      ? "What helped you figure it out?"
      : input.phase === "wrap_up"
        ? "Nice work — you finished this problem!"
        : (input.activeStep?.ask ?? null);

  return {
    currentPhase: input.phase,
    focusAsk,
    gateStatus: input.gateStatus,
    goalStatus: goalStatusFor(input),
    outputLanguageLabel: input.problemContext ? outputLanguageLabel(input.problemContext) : null,
    scaffoldAid: input.activeStep?.scaffoldAid ?? null,
    studentStatus: mapStudentStatusToLegacy(input.checkerVerdict?.studentStatus ?? "unknown"),
    supportLevel: input.supportLevel,
    unknownTarget: input.problemContext?.unknownTarget ?? null
  };
}

function goalStatusFor(input: {
  checkerVerdict: StepVerifierVerdict | null;
  fromPhase: SessionPhase;
  gateStatus: ComprehensionGateStatus | null;
  phase: SessionPhase;
}): VoicePipelineSessionState["goalStatus"] {
  if (input.gateStatus !== "complete") {
    return "empty";
  }

  if (
    input.phase === "memory_write" ||
    input.phase === "wrap_up" ||
    (input.fromPhase === "answer_check" && input.checkerVerdict?.studentStatus === "correct")
  ) {
    return "complete";
  }

  return "framed";
}

function mapStudentStatusToLegacy(status: StudentAssessmentStatus): StudentStatus {
  switch (status) {
    case "correct":
      return "correct";
    case "partial":
      return "partial";
    case "incorrect":
      return "stuck";
    default:
      return "unknown";
  }
}

function shouldEvaluateGateStage(
  phase: SessionPhase,
  gateStatus: ComprehensionGateStatus | null,
  studentText: string,
  problemContext: ProblemContextRecord | null
): problemContext is ProblemContextRecord {
  return (
    phase === "frame_task" &&
    isGateReadStatus(gateStatus) &&
    Boolean(studentText.trim()) &&
    Boolean(problemContext?.unknownTarget?.trim())
  );
}

function nextPhaseFor(
  fromPhase: SessionPhase,
  action: ProposedTutorAction,
  gateStatus: ComprehensionGateStatus | null
): SessionPhase {
  const proposed = action.statePatch?.nextPhase;
  return proposed && canTransition(fromPhase, proposed, gateStatus) ? proposed : fromPhase;
}

async function readStudentText(
  request: VoicePipelineTurnRequest,
  options: VoicePipelineOptions
): Promise<string> {
  const typedText = request.text?.trim() ?? "";

  if (!request.audio) {
    return typedText;
  }

  const transcript = await transcribeAudio(request.audio, options);
  return transcript || typedText;
}

async function transcribeAudio(
  audio: VoicePipelineAudioInput,
  options: VoicePipelineOptions
): Promise<string> {
  const apiKey = requireOpenAiApiKey(options.apiKey);
  const form = new FormData();
  const blob = dataUrlToBlob(audio.dataUrl, audio.mimeType);

  form.append("file", blob, audio.name ?? "student-turn.webm");
  form.append("model", options.transcribeModel);
  form.append("response_format", "json");

  const payload = await fetchOpenAiJson("https://api.openai.com/v1/audio/transcriptions", {
    apiKey,
    body: form,
    method: "POST"
  });
  const text = asString(asRecord(payload).text)?.trim();

  if (!text) {
    throw new HttpError(502, "OpenAI transcription response did not include text.", payload);
  }

  return text;
}

async function proposeTutorAction(
  input: TutorTurnInput,
  env: VoicePipelineServiceEnv
): Promise<ProposedTutorAction> {
  const phase = input.detail.session.currentPhase;
  const gateStatus = input.gateStatus;
  let rejectionReasons: string[] = [];

  for (let attempt = 0; attempt < maxTutorAttempts; attempt += 1) {
    const instructions = tutorActionInstructions(
      phase,
      gateStatus,
      input.stepVerifierVerdict,
      rejectionReasons,
      input.kickoff ?? false
    );
    const payload = await proposeTutorActionViaBinding(input, instructions, env);
    const outputText = extractOutputText(payload);

    if (!outputText) {
      throw new HttpError(502, "OpenAI tutor response did not include output text.", payload);
    }

    let parsed: JsonValue;
    try {
      parsed = JSON.parse(outputText) as JsonValue;
    } catch (error) {
      throw new HttpError(
        502,
        "OpenAI tutor response was not valid JSON.",
        error instanceof Error ? error.message : String(error)
      );
    }

    let proposed: ProposedTutorAction;
    try {
      proposed = proposedTutorActionFromJson(parsed, phase);
    } catch (error) {
      // A well-formed JSON object with an unusable move or shape is the model misbehaving —
      // the same class the validator catches — so re-ask rather than failing the whole turn.
      rejectionReasons = [error instanceof Error ? error.message : String(error)];
      continue;
    }

    const verdict = validateTutorAction(proposed, { phase });
    if (verdict.ok) {
      return proposed;
    }

    rejectionReasons = verdict.reasons;
  }

  throw new HttpError(502, "Tutor could not produce a valid turn within the phase rules.", {
    phase,
    reasons: rejectionReasons
  });
}

/**
 * The tutor's model call crosses the REASONING binding: the full scrubbed prompt
 * (instructions + the JSON prompt) ships as the workflow `input`, with the optional
 * per-turn image as a separate payload field. The re-ask loop wraps this — one binding
 * call per attempt — so a binding failure propagates as HttpError(502) and kills the turn
 * BEFORE commit (the tutor is NOT fail-soft; never retry past a successful commit since
 * TTS may have played).
 *
 * Returns the result wrapped in a synthetic `{ output_text }` envelope so the caller's
 * existing `extractOutputText` + `JSON.parse` + `proposedTutorActionFromJson` path is reused.
 */
async function proposeTutorActionViaBinding(
  input: TutorTurnInput,
  instructions: string,
  env: VoicePipelineServiceEnv
): Promise<JsonValue> {
  const composedInput = composeReasoningInput(instructions, createTutorPrompt(input));
  const extra: Record<string, JsonValue> = {};
  if (input.image) {
    extra.image = splitPromptImage(input.image.dataUrl);
  }
  const result = await runReasoningWorkflow("tutor-turn", composedInput, env, extra);
  return { output_text: JSON.stringify(result) };
}

async function createTutorSpeech(
  text: string,
  options: VoicePipelineOptions
): Promise<VoicePipelineAudioOutput> {
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    body: JSON.stringify({
      input: text,
      instructions:
        "Speak like a calm tutor. Use a warm, patient tone. Keep the delivery concise and leave space for the student to answer.",
      model: options.ttsModel,
      voice: options.voice
    }),
    headers: {
      Authorization: `Bearer ${requireOpenAiApiKey(options.apiKey)}`,
      "Content-Type": "application/json"
    },
    method: "POST",
    signal: AbortSignal.timeout(openAiRequestTimeoutMs)
  });

  if (!response.ok) {
    throw new HttpError(response.status, "OpenAI text-to-speech request failed", await fetchOpenAiSpeechError(response));
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    dataUrl: `data:${speechMimeType};base64,${bytesToBase64(bytes)}`,
    mimeType: speechMimeType,
    size: bytes.byteLength
  };
}

function createTutorPrompt(input: TutorTurnInput): string {
  const phase = input.detail.session.currentPhase;

  return JSON.stringify(
    {
      allowedMoves: allowedMoves(phase),
      // The conversational model only ever sees the answer-free step (ask + scaffold);
      // the verifier's answer key (expectedAnswers/distractorNudges) stays out of the prompt.
      activeStep: toPublicActiveStep(input.activeStep),
      comprehensionGate: {
        status: input.gateStatus,
        unknownTarget: scrubComputedSolutionFromText(input.problemContext?.unknownTarget ?? "") || null
      },
      currentPhase: phase,
      currentStudentTurn: input.studentText,
      currentSession: {
        imageName: input.detail.session.imageName,
        // Defense-in-depth: scrub any worked answer that slipped through extraction or a
        // typed-and-confirmed prompt before it can reach the model.
        imagePrompt: scrubComputedSolutionFromText(input.detail.session.imagePrompt ?? "") || null,
        status: input.detail.session.status,
        supportLevel: input.supportLevel
      },
      forbiddenMoves: forbiddenMoves(phase),
      problemFrame: input.problemContext
        ? {
            givens: input.problemContext.quantities,
            relationships: input.problemContext.relationships.map((relationship) =>
              scrubComputedSolutionFromText(relationship)
            ),
            unknownTarget: scrubComputedSolutionFromText(input.problemContext.unknownTarget ?? "") || null,
            visibleQuestion: scrubComputedSolutionFromText(input.problemContext.visibleQuestion)
          }
        : null,
      stepVerifierVerdict: input.stepVerifierVerdict,
      // Events are stored newest-first; take the 14 most recent and present them
      // oldest-to-newest so the model reads the conversation in order.
      recentHistory: input.detail.events
        .slice(0, 14)
        .reverse()
        .map((event) => ({
          message: event.message,
          value: event.value
        }))
    },
    null,
    2
  );
}

/** Tells the model which of the Three Reads to run for the current gate status. */
function gateReadNote(gateStatus: ComprehensionGateStatus | null): string {
  switch (gateStageForStatus(gateStatus)) {
    case "context":
      return "\nThree Reads — READ 1 (context): use three_reads_1. Have the child read it through and say, in their own words, what the problem is about. Do not touch the numbers or the question yet.";
    case "quantity":
      return "\nThree Reads — READ 2 (quantities): use three_reads_2. Ask what the important numbers are and what each one means. Solving stays locked.";
    case "target":
      return "\nThree Reads — READ 3 (the question): use three_reads_3. Ask what the problem is asking them to find — the goal, never the answer.";
    case "restatement":
      return "\nThree Reads — FINAL: use restate_prompt. Ask them to restate, in their own words, what they must find. Solving unlocks only once they do.";
    default:
      return "";
  }
}

function tutorActionInstructions(
  phase: SessionPhase,
  gateStatus: ComprehensionGateStatus | null,
  stepVerifierVerdict: StepVerifierVerdict | null,
  rejectionReasons: string[],
  kickoff: boolean
): string {
  const allowed = allowedMoves(phase).join(", ");
  const forbidden = forbiddenMoves(phase).join(", ");
  const kickoffNote = kickoff
    ? "\nThis is the opening turn — the student has not spoken yet. Greet them warmly as Coach Echo, briefly name the problem you'll work through together (use the problem frame), and invite them into the first reading. Do not solve, hint at, or reveal any answer."
    : "";
  const gateNote =
    phase === "frame_task" && isGateReadStatus(gateStatus)
      ? gateReadNote(gateStatus)
      : gateStatus === "complete"
        ? "\nThe comprehension gate is complete — you may acknowledge their restatement and move on when ready."
        : "";
  const gradedThing = phase === "answer_check" ? "final answer" : "step answer";
  const verifierNote = !stepVerifierVerdict
    ? ""
    : stepVerifierVerdict.studentStatus === "unknown"
      ? `\nA separate verifier could NOT confirm the student's ${gradedThing}. Do NOT affirm it as correct and do NOT reveal the answer; ask them to explain their thinking or restate their answer so it can be checked.
Verifier verdict: ${JSON.stringify(stepVerifierVerdict)}`
      : `\nA separate verifier already graded the student's ${gradedThing}. Do NOT contradict it or reveal the final answer.
Verifier verdict: ${JSON.stringify(stepVerifierVerdict)}
Weave correctionHint into spokenUtterance when wrong; on correct answers, affirm briefly with a why.`;
  const retry = rejectionReasons.length
    ? `\n\nYour previous attempt was rejected for these reasons:\n- ${rejectionReasons.join("\n- ")}\nChoose a different move or rephrase so it passes.`
    : "";

  return `${tutorPolicy.instructions}

You are the move generator for a server-enforced tutoring state machine. The server owns the phase; you only choose the next move and phrase it.

Current phase: "${phase}".
Moves you may use this phase: ${allowed}.
Never use these moves: ${forbidden} — they solve or reveal the answer.${kickoffNote}${gateNote}${verifierNote}

Hard rules:
- Return only the requested JSON schema.
- "move" must be one of the allowed moves above.
- "spokenUtterance" is the exact words spoken aloud: at most 32 words, exactly one cognitive demand (one question or one small step), ending so it clearly waits for the student. Never reveal the final answer.
- "nextPhase" is where the session should go next; keep it at "${phase}" unless the student is ready to move on.${retry}`;
}

const proposableMoves: readonly ProposedMove[] = [...tutorMoves, ...gateForbiddenMoves];

function proposedTutorActionFromJson(value: JsonValue, phase: SessionPhase): ProposedTutorAction {
  const record = asRecord(value);
  const move = asProposedMove(record.move);
  const spokenUtterance = asRequiredText(record.spokenUtterance, "spokenUtterance");
  const nextPhase = asOptionalSessionPhase(record.nextPhase);

  const action: ProposedTutorAction = { move, phase, spokenUtterance };
  if (nextPhase) {
    action.statePatch = { nextPhase };
  }

  return action;
}

function asProposedMove(value: JsonValue | undefined): ProposedMove {
  if (typeof value === "string" && proposableMoves.some((move) => move === value)) {
    return value as ProposedMove;
  }

  throw new Error("Invalid move");
}

function asOptionalSessionPhase(value: JsonValue | undefined): SessionPhase | undefined {
  if (typeof value === "string" && sessionPhases.some((candidate) => candidate === value)) {
    return value as SessionPhase;
  }

  return undefined;
}

// The client renders the legacy six-phase lesson shape; project the canonical turn
// onto it so the existing pipeline keeps working while the contract grows underneath.
// Both maps are typed as exhaustive Records, so adding a phase or move is a compile
// error here until its projection is declared — no silent fall-through to a default.
const lessonPhaseBySessionPhase: Record<SessionPhase, LessonPhase> = {
  session_open: "orient",
  capture_parse: "orient",
  frame_task: "orient",
  activate_prior: "orient",
  plan_first_step: "ask_step",
  step_loop: "ask_step",
  answer_check: "check_answer",
  memory_write: "wrap",
  transfer_check: "advance",
  wrap_up: "wrap"
};

const legacyTutorActionByMove: Record<ProposedMove, PublicLessonTurn["tutorAction"]> = {
  rapport_check: "orient",
  recall_prior: "orient",
  clarify_context: "orient",
  three_reads_1: "ask",
  three_reads_2: "ask",
  three_reads_3: "ask",
  restate_prompt: "ask",
  elicit: "ask",
  scaffold_hint: "hint",
  precision_check: "ask",
  feedback_with_why: "confirm",
  model_micro_step: "hint",
  fade: "hint",
  transfer_check: "ask",
  wrap: "wrap",
  reset: "orient",
  safety_boundary: "orient",
  escalate: "orient",
  // Leak markers never reach a validated turn, but the map must stay exhaustive.
  solve: "ask",
  final_answer: "ask",
  calculation_hint: "ask",
  check_answer: "ask"
};

function projectToPublicLesson(
  action: ProposedTutorAction,
  stepVerifierVerdict: StepVerifierVerdict | null
): PublicLessonTurn {
  return {
    phase: lessonPhaseBySessionPhase[action.phase],
    spokenUtterance: action.spokenUtterance,
    studentStatus: mapStudentStatusToLegacy(stepVerifierVerdict?.studentStatus ?? "unknown"),
    tutorAction: legacyTutorActionByMove[action.move]
  };
}

async function fetchOpenAiSpeechError(response: Response): Promise<JsonValue> {
  // The TTS call reads a binary body on success, so it can't share the JSON-text helper
  // the reasoning calls use; this is the one place the OpenAI client stays inline. The
  // error body, though, is JSON text — read it limited so an upstream error page can't
  // exhaust memory before the HttpError is thrown.
  const text = await readLimitedResponseText(response, maxOpenAiSpeechErrorBytes);

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return { error: text };
  }
}

async function readLimitedResponseText(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();

  if (!reader) {
    return "";
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      throw new HttpError(502, "OpenAI response was too large");
    }

    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(bytes);
}

/**
 * Splits a `data:<mime>;base64,<data>` URL into the Flue PromptImage fields the
 * tutor-turn workflow expects (`{ type: 'image', data, mimeType }`). The data URL is the
 * shape VoicePreparedImage already carries; the workflow reattaches it as a vision input.
 */
function splitPromptImage(dataUrl: string): JsonValue {
  const commaIndex = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || commaIndex < 0) {
    throw new HttpError(400, "Tutor image payload must be a base64 data URL.");
  }
  const metadata = dataUrl.slice("data:".length, commaIndex);
  const isBase64 = metadata.split(";").some((part) => part.toLowerCase() === "base64");
  if (!isBase64) {
    throw new HttpError(400, "Tutor image payload must be a base64 data URL.");
  }
  const parts = metadata.split(";");
  const first = parts[0] ?? "";
  const mimeType = first.includes("/") ? first : "image/jpeg";
  return { type: "image" as const, data: dataUrl.slice(commaIndex + 1), mimeType };
}

function dataUrlToBlob(dataUrl: string, fallbackMimeType: string): Blob {
  const commaIndex = dataUrl.indexOf(",");

  if (!dataUrl.startsWith("data:") || commaIndex < 0) {
    throw new HttpError(400, "Audio payload must be a base64 data URL.");
  }

  const metadata = dataUrl.slice("data:".length, commaIndex);
  const metadataParts = metadata.split(";").filter(Boolean);
  const isBase64 = metadataParts.some((part) => part.toLowerCase() === "base64");

  if (!isBase64) {
    throw new HttpError(400, "Audio payload must be a base64 data URL.");
  }

  const mimeType = metadataParts[0]?.includes("/") ? metadataParts[0] : fallbackMimeType;
  const binary = atob(dataUrl.slice(commaIndex + 1));
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function asRecord(value: JsonValue | undefined): Record<string, JsonValue> {
  return isJsonObject(value) ? (value as Record<string, JsonValue>) : {};
}

function asString(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function asRequiredText(value: JsonValue | undefined, key: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing ${key}`);
  }

  return value;
}
