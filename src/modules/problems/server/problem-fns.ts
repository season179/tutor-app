import { createServerFn } from "@tanstack/react-start";

import { authenticateServerRequest, workerEnv } from "../../../server-request-context.js";
import { createCloudflareObservability } from "../../../core/cloudflare-observability.js";
import { observeStage } from "../../../core/observability.js";
import { writeServerFnMiddleware } from "../../../core/server-fn-middleware.js";
import {
  createProblemContextHandlerEnv,
  handleExtractQuestionRequest,
  handlePreviewUrlRequest,
  handleUploadUrlRequest
} from "../problem-context-handler.js";
import type {
  ExtractQuestionRequest,
  PreviewUrlRequest,
  UploadUrlRequest
} from "../problem-context-types.js";

// Server-function adapters over the problem-context domain handlers. Each handler
// needs the R2 + vision env in addition to the per-user store/context, so the env is
// rebuilt from the Worker bindings inside the handler (server-only). The direct
// browser→R2 PUT stays a plain fetch in problem-context-api.ts — it is presigned by
// design and must not round-trip through the Worker. Each POST carries the shared
// 16 KB body cap (the R2 presign payloads are small; the image bytes go direct to
// R2) plus the error-status mapping middleware.

export const requestUploadUrlFn = createServerFn({ method: "POST" })
  .middleware(writeServerFnMiddleware)
  .validator((input: UploadUrlRequest) => input)
  .handler(async ({ data }) => {
    const { context, store } = await authenticateServerRequest();
    return handleUploadUrlRequest(data, createProblemContextHandlerEnv(workerEnv()), store, context);
  });

export const extractQuestionFn = createServerFn({ method: "POST" })
  .middleware(writeServerFnMiddleware)
  .validator((input: ExtractQuestionRequest) => input)
  .handler(async ({ data }) => {
    const { context, store } = await authenticateServerRequest();
    const observability = createCloudflareObservability({
      operation: "extract_question",
      requestId: crypto.randomUUID(),
      route: "server_fn",
      sessionId: data.sessionId,
      worker: "ai-tutor"
    });
    return observeStage(observability, "problem.extract_request", {}, () =>
      handleExtractQuestionRequest(
        data,
        createProblemContextHandlerEnv(workerEnv()),
        store,
        context,
        observability
      )
    );
  });

export const requestPreviewUrlFn = createServerFn({ method: "POST" })
  .middleware(writeServerFnMiddleware)
  .validator((input: PreviewUrlRequest) => input)
  .handler(async ({ data }) => {
    const { context, store } = await authenticateServerRequest();
    return handlePreviewUrlRequest(data, createProblemContextHandlerEnv(workerEnv()), store, context);
  });
