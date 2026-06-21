// Flue configuration for Worker B (ai-tutor-reasoning).
//
// This worker is a pure model executor: Worker A (ai-tutor) builds the full scrubbed
// prompt per reasoning call and ships it in the workflow payload's `input`; the agent
// here holds no stage prompt of its own. See docs/adr/0001-flue-reasoning-worker.md for
// the payload contract (Flue has no per-call `instructions` override, so the dynamic
// prompt travels as `input`).
import { defineConfig } from "@flue/cli/config";

export default defineConfig({
  target: "cloudflare"
});
