import { serve } from "@hono/node-server";

import { createProductionApp } from "./app.ts";

const server = serve({ fetch: createProductionApp().fetch, port: Number(process.env.PORT ?? 3000) });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
