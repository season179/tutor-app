import { z } from "zod";

import { PROVIDERS, SETTING_TYPES, isModelSettingType } from "./settings-types.js";
import type { ProviderSettingsPatch } from "./settings-types.js";

/**
 * Runtime validation for the save-settings payload. The validator on the server fn is the
 * last gate before the DB upsert, so it pins the accepted keys to the known union (a stray
 * key from the client is rejected rather than silently written) and rejects empty model
 * strings. Model slots are split `{ provider, model }` values; `tts_voice` remains a bare
 * string.
 *
 * Built as an explicit object with every key OPTIONAL, so a partial patch (only the slots the
 * user edited) validates. `z.record(z.enum(...), z.string())` would instead require every
 * enum key to be present, which breaks the diff-on-save flow. Each value, when present, must
 * be a non-empty string. The type annotation re-narrows to the patch type.
 */
const textValue = z.string().trim().min(1);
const providerModelValue = z
  .object({
    provider: z.enum(PROVIDERS),
    model: textValue
  })
  .strict();

const patchShape = Object.fromEntries(
  SETTING_TYPES.map((type) => [
    type,
    (isModelSettingType(type) ? providerModelValue : textValue).optional()
  ])
) as Record<
  (typeof SETTING_TYPES)[number],
  z.ZodOptional<typeof providerModelValue> | z.ZodOptional<typeof textValue>
>;

export const providerSettingsPatchSchema = z
  .object(patchShape)
  .strict() as unknown as z.ZodType<ProviderSettingsPatch>;
