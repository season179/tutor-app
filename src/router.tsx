import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";

import { NotFound } from "./client/components/NotFound.js";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  // Conservative defaults that preserve the previous hand-rolled fetch behaviour:
  // no automatic retries (the API surfaces 401/403 that must not be retried), and
  // no refetch on focus or reconnect — the old hooks only fetched on explicit
  // refresh/init, so an automatic reconnect refetch would flip the sessions
  // list's isFetching and flash the sidebar into its loading state mid-session.
  // Per-query overrides (e.g. live-session polling) live in the hooks.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: "intent",
    defaultNotFoundComponent: NotFound,
    scrollRestoration: true,
  });

  // Wires SSR dehydration/hydration and wraps the app in QueryClientProvider.
  // The tutoring route is ssr:false, so today this mainly provides the client-side
  // provider; it also future-proofs route-loader prefetch in Phase 4.
  setupRouterSsrQueryIntegration({ router, queryClient });

  return router;
}
