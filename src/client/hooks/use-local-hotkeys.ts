import { useHotkey, useHotkeySequence } from "@tanstack/react-hotkeys";
import { useNavigate } from "@tanstack/react-router";

/**
 * Local power-user keyboard shortcuts, registered only while the tutor screen
 * (`/`) is mounted (the hooks unregister on unmount). These are conveniences for
 * local dogfooding, not required for correctness.
 *
 * - `m` toggles the mic: start a session, begin recording, or stop+send.
 * - `/` focuses the composer.
 * - `g t` opens local traces; `g s` opens settings (vim-style sequences, so a
 *   stray single key never navigates).
 *
 * `ignoreInputs: true` keeps every shortcut from firing while a text input,
 * textarea, select, or contenteditable element has focus, so typing is never
 * interrupted. No visible instructional text is added to the UI.
 */
export type UseLocalHotkeysOptions = {
  canRecordAudioTurn: boolean;
  isRecording: boolean;
  isRunning: boolean;
  onStart: () => void;
  onStartAudioTurn: () => void;
  onFinishAudioTurn: () => void;
};

export function useLocalHotkeys({
  canRecordAudioTurn,
  isRecording,
  isRunning,
  onStart,
  onStartAudioTurn,
  onFinishAudioTurn
}: UseLocalHotkeysOptions) {
  const navigate = useNavigate();

  useHotkey(
    "M",
    () => {
      if (!isRunning) {
        onStart();
        return;
      }
      if (isRecording) {
        onFinishAudioTurn();
        return;
      }
      if (canRecordAudioTurn) {
        onStartAudioTurn();
      }
    },
    { ignoreInputs: true }
  );

  useHotkey(
    "/",
    () => {
      document
        .querySelector<HTMLElement>('input[aria-label="Message Coach Echo"]')
        ?.focus();
    },
    { ignoreInputs: true }
  );

  useHotkeySequence(["G", "T"], () => navigate({ to: "/debug/traces" }), {
    ignoreInputs: true
  });
  useHotkeySequence(["G", "S"], () => navigate({ to: "/settings" }), {
    ignoreInputs: true
  });
}
