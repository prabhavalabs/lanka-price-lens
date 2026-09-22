export { dealsCommand, type DealsCommandDeps } from "./cli.ts";
export { computeDeals, dealRules, dealsEngine, percentChange, shiftDay, type Deal, type DealKind, type DealsDay, type DeclaredOffer, type DealsOptions, type DealsRow, type EssentialWatch } from "./compute.ts";
export { defaultEssentialsPath, loadEssentials } from "./essentials.ts";
export { currentDealsDay, ensureDealsSchema, isCurrentDealsDay, latestDealsDay, readDealsDay, saveDealsDay } from "./store.ts";
