import { useEffect, useRef, useState } from "react";

import { authClient } from "../lib/auth-client.js";

export type AuthUser = {
  email?: string;
  id: string;
  isAnonymous?: boolean;
  name?: string;
};

export type AuthBootstrapState = "idle" | "bootstrapping" | "ready" | "error";

export function useAuth() {
  const { data: session, isPending } = authClient.useSession();
  const [bootstrapState, setBootstrapState] = useState<AuthBootstrapState>("idle");
  const bootstrapAttemptedRef = useRef(false);
  const previousUserIdRef = useRef<string | undefined>(undefined);

  const user = session?.user as AuthUser | undefined;
  const isAnonymous = Boolean(user?.isAnonymous);

  useEffect(() => {
    if (isPending) {
      return;
    }

    const previousUserId = previousUserIdRef.current;
    const currentUserId = user?.id;
    previousUserIdRef.current = currentUserId;

    if (user) {
      setBootstrapState("ready");
      return;
    }

    if (previousUserId) {
      bootstrapAttemptedRef.current = false;
      setBootstrapState("idle");
    }

    if (bootstrapAttemptedRef.current) {
      return;
    }

    bootstrapAttemptedRef.current = true;
    setBootstrapState("bootstrapping");

    void authClient.signIn
      .anonymous()
      .then((result) => {
        if (result.error) {
          setBootstrapState("error");
        }
      })
      .catch(() => {
        setBootstrapState("error");
      });
  }, [isPending, user]);

  const signInWithGoogle = () => authClient.signIn.social({ provider: "google" });

  const signOut = () => authClient.signOut();

  const isAuthLoading = isPending || (!user && bootstrapState !== "error");

  return {
    authError: bootstrapState === "error",
    isAnonymous,
    isAuthLoading,
    signInWithGoogle,
    signOut,
    user,
    userEmail: isAnonymous ? undefined : user?.email,
    userId: user?.id
  };
}
