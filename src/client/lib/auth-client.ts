import { createAuthClient } from "better-auth/react";
import { anonymousClient } from "better-auth/client/plugins";

// Same-origin: better-auth routes live at /api/auth/* on this host. The session
// cookie attaches automatically to all same-origin fetch calls.
export const authClient = createAuthClient({
  plugins: [anonymousClient()]
});
