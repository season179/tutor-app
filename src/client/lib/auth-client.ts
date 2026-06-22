import { createAuthClient } from "better-auth/react";
import { adminClient, anonymousClient } from "better-auth/client/plugins";

// Same-origin: better-auth routes live at /api/auth/* on this host. The session
// cookie attaches automatically to all same-origin fetch calls. adminClient mirrors
// the server's admin() plugin so `session.user.role` is typed client-side and the
// admin endpoints are reachable (used for the /settings role gate).
export const authClient = createAuthClient({
  plugins: [anonymousClient(), adminClient()]
});
