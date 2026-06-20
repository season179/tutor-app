import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";

import { routeTree } from "./routeTree.gen";

export function getRouter() {
  // Conservative defaults that preserve the previous hand-rolled fetch behaviour:
  // no automatic retries (the API surfaces 401/403 that must not be retried) and
  // no refetch-on-focus. Per-query overrides (e.g. live-session polling) live in
  // the hooks.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: "intent",
    scrollRestoration: true,
  });

  // Wires SSR dehydration/hydration and wraps the app in QueryClientProvider.
  // The tutoring route is ssr:false, so today this mainly provides the client-side
  // provider; it also future-proofs route-loader prefetch in Phase 4.
  setupRouterSsrQueryIntegration({ router, queryClient });

  return router;
}
