import type { OperationalDatabase } from "@lanka-pricelens/foundry/db";
import { latestDealsDay } from "@lanka-pricelens/foundry/deals";
import { Hono } from "hono";

import { envelope } from "./http.ts";

/**
 * The public deals read model, mounted by app.ts at /v1/public/deals: the latest computed day
 * as the foundry saved it (`deals compute --save` or the newsletter run). Nothing here touches
 * the warehouse; a deployment that has not computed a day yet answers 503.
 */

export type DealsBindings = { Variables: { requestId: string } };

export type DealsDeps = { database: OperationalDatabase };

export function dealsRoutes(deps: DealsDeps): Hono<DealsBindings> {
  const app = new Hono<DealsBindings>();

  app.get("/today", (context) => {
    const day = latestDealsDay(deps.database);
    if (!day) return context.json({ ...envelope(context.get("requestId"), null, false, "Deals are not available yet"), code: "DEALS_UNAVAILABLE" }, 503);
    return context.json(envelope(context.get("requestId"), day));
  });

  return app;
}
