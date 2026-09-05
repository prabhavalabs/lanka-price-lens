import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Connect, type Plugin } from "vite";

const apiTarget = "http://127.0.0.1:3000";
const adminBase = "/admin/";

/**
 * The production API redirects `/admin` to `/admin/`. Vite's dev and preview
 * servers instead answer a bare `/admin` (which React Router produces for the
 * index route) with a "did you mean to visit /admin/" page, so a browser
 * refresh on the overview broke. Mirror the production redirect here.
 */
function adminBaseRedirect(): Plugin {
  const redirect: Connect.NextHandleFunction = (request, response, next) => {
    const url = request.url ?? "";
    const bare = adminBase.slice(0, -1);
    if (url === bare || url.startsWith(`${bare}?`)) {
      response.writeHead(307, { Location: `${adminBase}${url.slice(bare.length)}` });
      response.end();
      return;
    }
    next();
  };
  return {
    name: "lanka-pricelens:admin-base-redirect",
    configureServer(server) {
      server.middlewares.use(redirect);
    },
    configurePreviewServer(server) {
      server.middlewares.use(redirect);
    },
  };
}

export default defineConfig({
  base: adminBase,
  plugins: [adminBaseRedirect(), react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  server: {
    proxy: {
      "/images": { target: apiTarget, changeOrigin: true },
      "/v1": {
        target: apiTarget,
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", (proxyRequest, request) => {
            const origin = request.headers.origin;
            if (origin && new URL(origin).host === request.headers.host) proxyRequest.setHeader("origin", apiTarget);
          });
        },
      },
    },
  },
});
