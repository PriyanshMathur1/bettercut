import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

// Dev:   npx vite --config editor/vite.config.ts      (API on :4790 via `python -m bettercut ui`)
// Build: npx vite build --config editor/vite.config.ts (served by the API server)
export default defineConfig({
  root: here,
  publicDir: `${here}../public`,
  plugins: [react()],
  server: { port: 4791, proxy: { "/api": "http://127.0.0.1:4790" } },
  build: { outDir: `${here}dist`, emptyOutDir: true, chunkSizeWarningLimit: 4000 },
});
