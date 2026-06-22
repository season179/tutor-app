import assert from "node:assert/strict";

import {
  PROVIDERS,
  providerModelSpecifier,
  splitProviderModelSpecifier
} from "../src/modules/settings/settings-types.ts";

test("splitProviderModelSpecifier splits a legacy provider/model value at the first slash", () => {
  assert.deepEqual(splitProviderModelSpecifier("openai/gpt-5.5"), {
    provider: "openai",
    model: "gpt-5.5"
  });
  assert.deepEqual(splitProviderModelSpecifier("anthropic/claude-opus-4"), {
    provider: "anthropic",
    model: "claude-opus-4"
  });
});

test("splitProviderModelSpecifier keeps nested OpenRouter model paths intact", () => {
  const { provider, model } = splitProviderModelSpecifier("openrouter/nvidia/nemotron-3-ultra-550b-a55b");
  assert.equal(provider, "openrouter");
  assert.equal(model, "nvidia/nemotron-3-ultra-550b-a55b");
});

test("splitProviderModelSpecifier defaults the provider when the value has no slash", () => {
  const { provider, model } = splitProviderModelSpecifier("gpt-5.5");
  assert.equal(provider, PROVIDERS[0]);
  assert.equal(model, "gpt-5.5");
});

test("splitProviderModelSpecifier keeps the full value as model when the provider is unknown", () => {
  const { provider, model } = splitProviderModelSpecifier("somelab/their-model");
  assert.equal(provider, PROVIDERS[0]);
  assert.equal(model, "somelab/their-model");
});

test("providerModelSpecifier formats split settings for Flue/Pi reasoning calls", () => {
  assert.equal(
    providerModelSpecifier({ provider: "openrouter", model: "nvidia/nemotron" }),
    "openrouter/nvidia/nemotron"
  );
  assert.equal(providerModelSpecifier({ provider: "openai", model: "  gpt-5.5  " }), "openai/gpt-5.5");
});

test("providerModelSpecifier returns empty for an empty model", () => {
  assert.equal(providerModelSpecifier({ provider: "openai", model: "" }), "");
  assert.equal(providerModelSpecifier({ provider: "openai", model: "   " }), "");
});
