import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";

// Vite (with Rolldown) is the client bundler and powers TanStack Start SSR.
// Plugin order matters: cloudflare → tanstackStart → viteReact (per the CF + Start docs).
export default defineConfig({
  server: {
    // Honour the PORT that Portless injects; fall back to 3000 for bare `vite dev`.
    // Use an explicit presence check so a deliberate PORT=0 or empty PORT isn't
    // silently coerced to 3000 by `||`.
    port: process.env.PORT ? Number(process.env.PORT) : 3000,
    // Portless proxies to the exact port it assigned, so if that port is taken
    // Vite must fail loudly rather than drift to the next free one (which would
    // leave Portless routing to a dead port).
    strictPort: true,
  },
  preview: {
    // `vite preview` ignores `server.*`; mirror the dev convention so PORT is honoured.
    port: process.env.PORT ? Number(process.env.PORT) : 4173,
  },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tanstackStart(),
    viteReact(),
  ],
});
