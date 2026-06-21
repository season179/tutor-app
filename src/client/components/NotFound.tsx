import { useNavigate } from "@tanstack/react-router";

import { ActionButton } from "./ActionButton.js";

// Rendered when a request doesn't match any route — a stray path, a mistyped
// link, or the browser asking for something like /favicon.ico. Coach Echo lives
// entirely at "/", so the only useful action is a way back there. Reuses the
// sign-in card chrome so the 404 still feels like the app.
export function NotFound() {
  const navigate = useNavigate();

  return (
    <main className="sign-in-screen">
      <div className="sign-in-card">
        <span className="brand-mark brand-mark-lg" aria-hidden="true" />
        <h1>Page not found</h1>
        <p>That page doesn’t exist. Let’s get you back to your coach.</p>
        <ActionButton variant="primary" onClick={() => void navigate({ to: "/" })}>
          Back to Coach Echo
        </ActionButton>
      </div>
    </main>
  );
}
