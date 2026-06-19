import { HttpError, type JsonValue } from "./http-error.js";
import { deriveFirstCheckableStep, type ActiveStep } from "./active-step.js";
import { checkGateRestatement } from "./gate-checker.js";
import { allowedMoves, allowedNextPhases, canTransition, forbiddenMoves } from "./phase-policy.js";
import type { ProblemContextRecord } from "./problem-context/problem-frame.js";
import type { RequestContext } from "./request-context.js";
import type { SessionStore } from "./session-store.js";
import {
  studentTurnEventMessage,
  tutorTurnEventMessage,
  type TutorSessionDetail
} from "./session-types.js";
import {
  shouldVerifyActiveStep,
  verifyActiveStep,
  type StepVerifierVerdict
} from "./step-verifier.js";
import {
  gateForbiddenMoves,
  sessionPhases,
  tutorMoves,
  type ProposedMove,
  type ProposedTutorAction,
  type SessionPhase,
  type ComprehensionGateStatus,
  type StudentAssessmentStatus,
  type SupportLevel
} from "./tutor-action.js";
import { isJsonObject } from "./schema-parser.js";
import { validateTutorAction } from "./tutor-action-validator.js";
import { tutorPolicy } from "./tutor-policy.js";
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

const maxOpenAiJsonResponseBytes = 256_000;
const openAiRequestTimeoutMs = 30_000;
const speechMimeType = "audio/mpeg";
// How many times the generator may be re-asked when its proposed turn fails the
// phase rules before we give up. The gate must never be talked past, so a turn that
// keeps proposing illegal moves fails rather than reaching TTS.
const maxTutorAttempts = 2;

export type VoicePipelineServiceEnv = {
  OPENAI_API_KEY: string | undefined;
  OPENAI_GATE_CHECKER_MODEL?: string | undefined;
  OPENAI_TRANSCRIBE_MODEL: string | undefined;
  OPENAI_TTS_MODEL: string | undefined;
  OPENAI_TTS_VOICE: string | undefined;
  OPENAI_TUTOR_MODEL: string | undefined;
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
  const studentText = await readStudentText(request, options);
  const fromPhase = detail.session.currentPhase;
  let gateStatus = detail.session.gateStatus;
  const problemContext = await store.getProblemContext(requestContext.ownerKey, request.sessionId);

  let gateVerdict: Awaited<ReturnType<typeof checkGateRestatement>> | null = null;
  if (shouldEvaluateGateRestatement(fromPhase, gateStatus, studentText, problemContext)) {
    gateVerdict = await checkGateRestatement(problemContext!, studentText, env);
    if (gateVerdict.accepted) {
      gateStatus = "complete";
    }
  }

  let activeStep = detail.session.activeStep;
  if (!activeStep && shouldSeedActiveStep(fromPhase, gateStatus, problemContext)) {
    activeStep = deriveFirstCheckableStep(problemContext!);
  }

  let stepVerifierVerdict: StepVerifierVerdict | null = null;
  if (activeStep && shouldRunStepVerifier(fromPhase, gateStatus, studentText)) {
    stepVerifierVerdict = verifyActiveStep(activeStep, studentText);
  }

  const supportLevel = nextSupportLevel(
    detail.session.supportLevel,
    stepVerifierVerdict,
    studentText
  );

  const action = await proposeTutorAction(
    {
      activeStep,
      detail,
      gateStatus,
      image: request.image ?? null,
      problemContext,
      stepVerifierVerdict,
      studentText,
      supportLevel
    },
    options
  );

  const audio = await createTutorSpeech(action.spokenUtterance, options);
  const publicLesson = projectToPublicLesson(action, stepVerifierVerdict);
  const toPhase = nextPhaseFor(fromPhase, action, gateStatus);
  const sessionState = buildSessionState({
    activeStep,
    gateStatus,
    phase: toPhase,
    problemContext,
    stepVerifierVerdict,
    supportLevel
  });
  const response = serializeVoicePipelineTurnResponse({
    audio,
    lesson: publicLesson,
    session: sessionState,
    transcript: studentText,
    tutorText: action.spokenUtterance
  });

  // Optimistic lock on the phase we read. A null result means a concurrent turn already
  // moved the session off `fromPhase`, so this turn is stale: bail rather than recording a
  // transition that never happened or speaking over the turn that won the race.
  const advanced = await store.advanceSessionPhase(requestContext.ownerKey, request.sessionId, fromPhase, {
    activeStep,
    currentPhase: toPhase,
    gateStatus,
    supportLevel
  });
  if (!advanced) {
    throw new HttpError(409, "This session was advanced by another turn. Please retry.");
  }
  // Only the first turn flips draft → active; skip the write once it already is.
  if (detail.session.status !== "active") {
    await store.updateSession(requestContext.ownerKey, request.sessionId, { status: "active" });
  }
  await store.appendEvent(requestContext.ownerKey, request.sessionId, {
    message: request.image && !request.audio ? "Problem image submitted" : studentTurnEventMessage,
    value: {
      hasAudio: Boolean(request.audio),
      hasImage: Boolean(request.image),
      text: studentText
    }
  });
  if (gateVerdict) {
    await store.appendEvent(requestContext.ownerKey, request.sessionId, {
      message: "Gate check",
      value: {
        accepted: gateVerdict.accepted,
        notes: gateVerdict.notes,
        studentText
      }
    });
  }
  if (stepVerifierVerdict) {
    await store.appendEvent(requestContext.ownerKey, request.sessionId, {
      message: "Step verify",
      value: {
        chip: stepVerifierVerdict.chip,
        chipLabel: stepVerifierVerdict.chipLabel,
        correctionHint: stepVerifierVerdict.correctionHint,
        method: stepVerifierVerdict.method,
        studentAnswer: stepVerifierVerdict.studentAnswer,
        studentStatus: stepVerifierVerdict.studentStatus,
        studentText
      }
    });
  }
  await store.appendEvent(requestContext.ownerKey, request.sessionId, {
    message: tutorTurnEventMessage,
    value: {
      lesson: publicLesson,
      move: action.move,
      phase: fromPhase,
      nextPhase: toPhase,
      text: action.spokenUtterance,
      verdict:
        stepVerifierVerdict === null
          ? null
          : {
              chip: stepVerifierVerdict.chip,
              label: stepVerifierVerdict.chipLabel
            }
    }
  });

  return response;
}

function shouldSeedActiveStep(
  phase: SessionPhase,
  gateStatus: ComprehensionGateStatus | null,
  problemContext: ProblemContextRecord | null
): problemContext is ProblemContextRecord {
  return (
    (phase === "plan_first_step" || phase === "step_loop") &&
    gateStatus === "complete" &&
    Boolean(problemContext)
  );
}

function shouldRunStepVerifier(
  phase: SessionPhase,
  gateStatus: ComprehensionGateStatus | null,
  studentText: string
): boolean {
  return phase === "step_loop" && gateStatus === "complete" && shouldVerifyActiveStep(studentText);
}

function nextSupportLevel(
  current: SupportLevel,
  verdict: StepVerifierVerdict | null,
  studentText: string
): SupportLevel {
  if (!verdict || verdict.method === "skipped") {
    return current;
  }

  if (verdict.studentStatus === "correct" && studentText.trim().split(/\s+/).length >= 4) {
    return Math.max(0, current - 1) as SupportLevel;
  }

  if (verdict.studentStatus === "incorrect" || verdict.studentStatus === "partial") {
    return Math.min(4, current + 1) as SupportLevel;
  }

  return current;
}

function buildSessionState(input: {
  activeStep: ActiveStep | null;
  gateStatus: ComprehensionGateStatus | null;
  phase: SessionPhase;
  problemContext: ProblemContextRecord | null;
  stepVerifierVerdict: StepVerifierVerdict | null;
  supportLevel: SupportLevel;
}): VoicePipelineSessionState {
  return {
    currentPhase: input.phase,
    focusAsk: input.activeStep?.ask ?? null,
    gateStatus: input.gateStatus,
    scaffoldAid: input.activeStep?.scaffoldAid ?? null,
    studentStatus: mapStudentStatusToLegacy(input.stepVerifierVerdict?.studentStatus ?? "unknown"),
    supportLevel: input.supportLevel,
    unknownTarget: input.problemContext?.unknownTarget ?? null
  };
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

function shouldEvaluateGateRestatement(
  phase: SessionPhase,
  gateStatus: ComprehensionGateStatus | null,
  studentText: string,
  problemContext: ProblemContextRecord | null
): problemContext is ProblemContextRecord {
  return (
    phase === "frame_task" &&
    gateStatus === "needs_restatement" &&
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
  const apiKey = requireOpenAiApiKey(options);
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
  options: VoicePipelineOptions
): Promise<ProposedTutorAction> {
  const phase = input.detail.session.currentPhase;
  const gateStatus = input.gateStatus;
  let rejectionReasons: string[] = [];

  for (let attempt = 0; attempt < maxTutorAttempts; attempt += 1) {
    const payload = await fetchOpenAiJson("https://api.openai.com/v1/responses", {
      apiKey: requireOpenAiApiKey(options),
      body: JSON.stringify({
        input: createTutorInput(input),
        instructions: tutorActionInstructions(phase, gateStatus, input.stepVerifierVerdict, rejectionReasons),
        model: options.tutorModel,
        text: {
          format: {
            name: "tutor_action",
            schema: proposedTutorActionJsonSchema(phase, gateStatus),
            strict: true,
            type: "json_schema"
          }
        }
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
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
      Authorization: `Bearer ${requireOpenAiApiKey(options)}`,
      "Content-Type": "application/json"
    },
    method: "POST",
    signal: AbortSignal.timeout(openAiRequestTimeoutMs)
  });

  if (!response.ok) {
    throw new HttpError(response.status, "OpenAI text-to-speech request failed", await readOpenAiError(response));
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    dataUrl: `data:${speechMimeType};base64,${bytesToBase64(bytes)}`,
    mimeType: speechMimeType,
    size: bytes.byteLength
  };
}

function createTutorInput(input: TutorTurnInput): Array<Record<string, JsonValue>> {
  const content: Array<Record<string, JsonValue>> = [
    {
      text: createTutorPrompt(input),
      type: "input_text"
    }
  ];

  if (input.image) {
    content.push({
      image_url: input.image.dataUrl,
      type: "input_image"
    });
  }

  return [
    {
      content,
      role: "user"
    }
  ];
}

function createTutorPrompt(input: TutorTurnInput): string {
  const phase = input.detail.session.currentPhase;

  return JSON.stringify(
    {
      allowedMoves: allowedMoves(phase),
      activeStep: input.activeStep,
      comprehensionGate: {
        status: input.gateStatus,
        unknownTarget: input.problemContext?.unknownTarget ?? null
      },
      currentPhase: phase,
      currentStudentTurn: input.studentText,
      currentSession: {
        imageName: input.detail.session.imageName,
        imagePrompt: input.detail.session.imagePrompt,
        status: input.detail.session.status,
        supportLevel: input.supportLevel
      },
      forbiddenMoves: forbiddenMoves(phase),
      problemFrame: input.problemContext
        ? {
            givens: input.problemContext.quantities,
            relationships: input.problemContext.relationships,
            unknownTarget: input.problemContext.unknownTarget,
            visibleQuestion: input.problemContext.visibleQuestion
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

function tutorActionInstructions(
  phase: SessionPhase,
  gateStatus: ComprehensionGateStatus | null,
  stepVerifierVerdict: StepVerifierVerdict | null,
  rejectionReasons: string[]
): string {
  const allowed = allowedMoves(phase).join(", ");
  const forbidden = forbiddenMoves(phase).join(", ");
  const gateNote =
    phase === "frame_task" && gateStatus !== "complete"
      ? "\nThe comprehension gate is NOT complete — do not advance to planning or solving; help the child restate what we are finding."
      : gateStatus === "complete"
        ? "\nThe comprehension gate is complete — you may acknowledge their restatement and move on when ready."
        : "";
  const verifierNote = stepVerifierVerdict
    ? `\nA separate verifier already graded the student's step answer. Do NOT contradict it or reveal the final answer.
Verifier verdict: ${JSON.stringify(stepVerifierVerdict)}
Weave correctionHint into spokenUtterance when wrong; on correct answers, affirm briefly with a why.`
    : "";
  const retry = rejectionReasons.length
    ? `\n\nYour previous attempt was rejected for these reasons:\n- ${rejectionReasons.join("\n- ")}\nChoose a different move or rephrase so it passes.`
    : "";

  return `${tutorPolicy.instructions}

You are the move generator for a server-enforced tutoring state machine. The server owns the phase; you only choose the next move and phrase it.

Current phase: "${phase}".
Moves you may use this phase: ${allowed}.
Never use these moves: ${forbidden} — they solve or reveal the answer.${gateNote}${verifierNote}

Hard rules:
- Return only the requested JSON schema.
- "move" must be one of the allowed moves above.
- "spokenUtterance" is the exact words spoken aloud: at most 32 words, exactly one cognitive demand (one question or one small step), ending so it clearly waits for the student. Never reveal the final answer.
- "nextPhase" is where the session should go next; keep it at "${phase}" unless the student is ready to move on.${retry}`;
}

function proposedTutorActionJsonSchema(
  phase: SessionPhase,
  gateStatus: ComprehensionGateStatus | null
): Record<string, JsonValue> {
  return {
    additionalProperties: false,
    properties: {
      move: { enum: [...allowedMoves(phase)], type: "string" },
      nextPhase: { enum: [...allowedNextPhases(phase, gateStatus)], type: "string" },
      spokenUtterance: { type: "string" }
    },
    required: ["move", "nextPhase", "spokenUtterance"],
    type: "object"
  };
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

async function fetchOpenAiJson(
  url: string,
  init: RequestInit & { apiKey: string; headers?: Record<string, string> }
): Promise<JsonValue> {
  const { apiKey, headers, ...requestInit } = init;
  const response = await fetch(url, {
    ...requestInit,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...headers
    },
    signal: AbortSignal.timeout(openAiRequestTimeoutMs)
  });
  const payload = await readOpenAiJson(response);

  if (!response.ok) {
    throw new HttpError(response.status, "OpenAI request failed", payload);
  }

  return payload;
}

async function readOpenAiJson(response: Response): Promise<JsonValue> {
  const text = await readLimitedResponseText(response, maxOpenAiJsonResponseBytes);

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return { error: text };
  }
}

async function readOpenAiError(response: Response): Promise<JsonValue> {
  return readOpenAiJson(response);
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

function extractOutputText(payload: JsonValue): string {
  const root = asRecord(payload);
  const direct = asString(root.output_text);

  if (direct) {
    return direct;
  }

  const output = Array.isArray(root.output) ? root.output : [];
  const pieces: string[] = [];

  for (const item of output) {
    const content = asRecord(item).content;

    if (!Array.isArray(content)) {
      continue;
    }

    for (const part of content) {
      const record = asRecord(part);
      const text = asString(record.text);

      if (text) {
        pieces.push(text);
      }
    }
  }

  return pieces.join("\n").trim();
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

function requireOpenAiApiKey(options: VoicePipelineOptions): string {
  if (!options.apiKey) {
    throw new HttpError(500, "Missing OPENAI_API_KEY");
  }

  return options.apiKey;
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
