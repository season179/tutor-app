import { useEffect, useRef, useState } from "react";

import { useMutation } from "@tanstack/react-query";

import { authClient } from "../lib/auth-client.js";

export type AuthUser = {
  email?: string;
  id: string;
  isAnonymous?: boolean;
  name?: string;
  // The better-auth admin-plugin role (default "user"); surfaced for the /settings gate.
  role?: string;
};

export type AuthBootstrapState = "idle" | "bootstrapping" | "ready" | "error";

export function useAuth() {
  const { data: session, isPending } = authClient.useSession();
  const [bootstrapState, setBootstrapState] = useState<AuthBootstrapState>("idle");
  const bootstrapAttemptedRef = useRef(false);
  const previousUserIdRef = useRef<string | undefined>(undefined);

  const user = session?.user as AuthUser | undefined;
  const isAnonymous = Boolean(user?.isAnonymous);
  const role = user?.role ?? "user";
  const isAdmin = role === "admin";

  // better-auth's `useSession` is the reactive source; the three imperative
  // actions go through mutations so their in-flight/error state is managed by
  // Query. better-auth resolves with `{ error }` rather than throwing on auth
  // failures, so the bootstrap still inspects `result.error` itself.
  const { mutateAsync: signInAnonymously } = useMutation({
    mutationFn: () => authClient.signIn.anonymous()
  });
  // mutateAsync (not mutate) so the returned functions keep the better-auth
  // promise the previous direct calls exposed — same return contract, same
  // rejection propagation.
  const { mutateAsync: signInGoogle } = useMutation({
    mutationFn: () => authClient.signIn.social({ provider: "google" })
  });
  const { mutateAsync: signOutMutate } = useMutation({
    mutationFn: () => authClient.signOut()
  });

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

    void signInAnonymously()
      .then((result) => {
        if (result.error) {
          setBootstrapState("error");
        }
      })
      .catch(() => {
        setBootstrapState("error");
      });
  }, [isPending, signInAnonymously, user]);

  const signInWithGoogle = () => signInGoogle();

  const signOut = () => signOutMutate();

  const isAuthLoading = isPending || (!user && bootstrapState !== "error");

  return {
    authError: bootstrapState === "error",
    isAnonymous,
    isAdmin,
    role,
    isAuthLoading,
    signInWithGoogle,
    signOut,
    user,
    userEmail: isAnonymous ? undefined : user?.email,
    userId: user?.id
  };
}
