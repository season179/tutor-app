import { ActionButton } from "./ActionButton.js";

type SignInScreenProps = {
  message?: string;
  onSignIn: () => void;
};

export function SignInScreen({ message, onSignIn }: SignInScreenProps) {
  return (
    <main className="sign-in-screen">
      <div className="sign-in-card">
        <span className="brand-mark brand-mark-lg" aria-hidden="true" />
        <h1>Coach Echo</h1>
        <p>{message ?? "Your voice homework coach"}</p>
        <ActionButton variant="primary" onClick={onSignIn}>
          Sign in with Google
        </ActionButton>
      </div>
    </main>
  );
}
