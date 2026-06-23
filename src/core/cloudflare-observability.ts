import { tracing } from "cloudflare:workers";

import {
  createObservabilityContext,
  type ObservabilityAttributes,
  type ObservabilityContext
} from "./observability.js";

export function createCloudflareObservability(
  base: ObservabilityAttributes
): ObservabilityContext {
  return createObservabilityContext(base, {
    enterSpan: (name, _attributes, callback) => tracing.enterSpan(name, (span) => callback(span))
  });
}
