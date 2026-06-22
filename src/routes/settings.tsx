import { createFileRoute } from "@tanstack/react-router";

import { SettingsPage } from "../client/components/settings/SettingsPage.js";

// The settings page is a normal authenticated read/write page — the settings query and the
// auth session both work under SSR, so unlike the browser-stateful workspace (`/`), this
// route SSRs. Auth is enforced inside the server fns (401) and re-checked in the page
// component (guests are gated to the sign-in screen).
export const Route = createFileRoute("/settings")({
  ssr: true,
  component: SettingsPage,
});
