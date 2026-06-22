import { createServerFn } from "@tanstack/react-start";

import { authenticateServerRequest, workerEnv } from "../../../server-request-context.js";
import {
  serverFnMiddleware,
  writeServerFnMiddleware
} from "../../../core/server-fn-middleware.js";
import { D1SettingsStore } from "../settings-store.js";
import { providerSettingsPatchSchema } from "../settings-schema.js";
import type { ProviderSettings, ProviderSettingsPatch } from "../settings-types.js";
import { requireAdmin } from "./settings-admin-gate.js";

// Thin server-function adapters over the provider/model settings store. Mirrors the session
// server fns: a GET reads the full typed snapshot, a POST upserts a partial patch. Both
// require an AUTHENTICATED ADMIN session (the gate below) — settings mutate global config, so
// only users whose `role === "admin"` may read or write them. The gate here is the real
// protection layer; the frontend hides the page/link for non-admins, but a direct server-fn
// call from a non-admin still fails with 403 here.

export const getSettingsFn = createServerFn({ method: "GET" })
  .middleware(serverFnMiddleware)
  .handler(async (): Promise<ProviderSettings> => {
    const { context } = await authenticateServerRequest();
    requireAdmin(context.identity.role);
    const store = new D1SettingsStore(workerEnv().DB);
    return store.getAllSettings();
  });

export const saveSettingsFn = createServerFn({ method: "POST" })
  .middleware(writeServerFnMiddleware)
  .validator((input: ProviderSettingsPatch) => providerSettingsPatchSchema.parse(input))
  .handler(async ({ data }): Promise<ProviderSettings> => {
    const { context } = await authenticateServerRequest();
    requireAdmin(context.identity.role);
    const store = new D1SettingsStore(workerEnv().DB);
    return store.saveSettings(data);
  });
