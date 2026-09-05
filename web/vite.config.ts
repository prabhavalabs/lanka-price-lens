import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The public site lives at the root of its own host; in development the API answers on port 3000.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  server: { port: 5174, proxy: { "/v1": { target: "http://127.0.0.1:3000", changeOrigin: true } } },
  build: { sourcemap: false },
});
