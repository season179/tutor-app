export type ObservabilityAttribute = string | number | boolean | null | undefined;
export type ObservabilityAttributes = Record<string, ObservabilityAttribute>;

export type ObservabilitySpan = {
  readonly isTraced?: boolean;
  setAttribute(key: string, value: string | number | boolean | undefined): void;
};

type StageCallback<T> = (span?: ObservabilitySpan) => T | Promise<T>;

export type ObservabilityContext = {
  base: ObservabilityAttributes;
  emitLog?: (entry: Record<string, unknown>, level: "log" | "error") => void;
  enterSpan?: <T>(
    name: string,
    attributes: ObservabilityAttributes,
    callback: StageCallback<T>
  ) => T | Promise<T>;
};

export function createObservabilityContext(
  base: ObservabilityAttributes,
  options: {
    emitLog?: ObservabilityContext["emitLog"];
    enterSpan?: ObservabilityContext["enterSpan"];
  } = {}
): ObservabilityContext {
  return {
    base: sanitizeAttributes(base),
    ...(options.emitLog ? { emitLog: options.emitLog } : {}),
    ...(options.enterSpan ? { enterSpan: options.enterSpan } : {})
  };
}

export function extendObservability(
  context: ObservabilityContext | undefined,
  base: ObservabilityAttributes
): ObservabilityContext | undefined {
  if (!context) {
    return undefined;
  }

  return {
    ...context,
    base: {
      ...context.base,
      ...sanitizeAttributes(base)
    }
  };
}

export async function observeStage<T>(
  context: ObservabilityContext | undefined,
  stage: string,
  attributes: ObservabilityAttributes,
  callback: StageCallback<T>
): Promise<T> {
  if (!context) {
    return callback();
  }

  const startedAt = performance.now();
  const stageAttributes = sanitizeAttributes({ stage, ...attributes });
  let status: "ok" | "error" = "ok";
  let thrown: unknown;

  try {
    const run = async (span?: ObservabilitySpan): Promise<T> => {
      setSpanAttributes(span, stageAttributes);
      return callback(span);
    };

    if (context.enterSpan) {
      return await context.enterSpan(stage, stageAttributes, run);
    }

    return await run();
  } catch (error) {
    status = "error";
    thrown = error;
    throw error;
  } finally {
    emitStageTiming(context, stageAttributes, startedAt, status, thrown);
  }
}

export function setSpanAttributes(
  span: ObservabilitySpan | undefined,
  attributes: ObservabilityAttributes
): void {
  if (!span) {
    return;
  }

  for (const [key, value] of Object.entries(sanitizeAttributes(attributes))) {
    if (value === null) {
      continue;
    }
    span.setAttribute(key, value);
  }
}

function emitStageTiming(
  context: ObservabilityContext,
  stageAttributes: ObservabilityAttributes,
  startedAt: number,
  status: "ok" | "error",
  thrown: unknown
): void {
  const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
  const entry: Record<string, unknown> = {
    message: "ai_tutor_stage_timing",
    ...sanitizeAttributes(context.base),
    ...stageAttributes,
    durationMs,
    status
  };

  if (thrown) {
    entry.errorName = thrown instanceof Error ? thrown.name : "Error";
    entry.errorMessage = truncateForLog(thrown instanceof Error ? thrown.message : String(thrown));
  }

  const emit = context.emitLog ?? defaultEmitLog;
  emit(entry, status === "error" ? "error" : "log");
}

function defaultEmitLog(entry: Record<string, unknown>, level: "log" | "error"): void {
  const serialized = JSON.stringify(entry);
  if (level === "error") {
    console.error(serialized);
  } else {
    console.log(serialized);
  }
}

function sanitizeAttributes(attributes: ObservabilityAttributes): ObservabilityAttributes {
  const sanitized: ObservabilityAttributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined) {
      continue;
    }
    sanitized[key] = value;
  }
  return sanitized;
}

function truncateForLog(value: string): string {
  return value.length > 180 ? `${value.slice(0, 177)}...` : value;
}
