import type { WatchAlert, WatchEntry } from "@lanka-pricelens/shared";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { accountApi, AccountApiError } from "../lib/account-api.ts";
import { useAccount } from "./account.ts";

/**
 * The wishlist on the account: the starred products with today's cheapest seller and each
 * one's alert rule. One query shared by every star on the page, updated in place when a star
 * is pressed so the change shows before the server answers.
 */

export const watchlistQueryKey = (accountId: string) => ["account", "watchlist", accountId] as const;

export type WatchlistStatus = "loading" | "ready" | "error" | "signed_out";
export type WatchlistResult = { items: WatchEntry[]; status: WatchlistStatus; error: unknown; refetch: () => void; priced: boolean };

type Listing = { items: WatchEntry[]; priced: boolean };

function readListing(client: QueryClient, accountId: string): Listing {
  return client.getQueryData<Listing>(watchlistQueryKey(accountId)) ?? { items: [], priced: false };
}

/** The signed-in person's wishlist; empty while signed out. */
export function useWatchlist(): WatchlistResult {
  const account = useAccount();
  const accountId = account.status === "signed_in" ? account.account.id : "";
  const query = useQuery({
    queryKey: watchlistQueryKey(accountId),
    queryFn: async ({ signal }): Promise<Listing> => {
      try {
        const listing = await accountApi.watchlist.list(signal);
        return { items: listing.items, priced: listing.priced };
      } catch (error) {
        if (error instanceof AccountApiError && error.status === 401) return { items: [], priced: false };
        throw error;
      }
    },
    enabled: Boolean(accountId),
    staleTime: 60_000,
  });
  const refetch = () => void query.refetch();
  if (account.status === "signed_out") return { items: [], status: "signed_out", error: null, refetch, priced: false };
  if (account.status === "loading" || query.isPending) return { items: [], status: "loading", error: null, refetch, priced: false };
  if (query.isError && !query.data) return { items: [], status: "error", error: query.error, refetch, priced: false };
  return { items: query.data?.items ?? [], status: "ready", error: null, refetch, priced: query.data?.priced ?? false };
}

/** Whether one product is starred, and the entry when it is. */
export function useWatched(productId: string): { watched: boolean; entry: WatchEntry | null; status: WatchlistStatus } {
  const { items, status } = useWatchlist();
  const entry = items.find((item) => item.product_id === productId) ?? null;
  return { watched: entry !== null, entry, status };
}

export type WatchActions = {
  /** Stars or unstars a product; answers the new state, or null when the server refused. */
  toggle: (productId: string) => Promise<boolean | null>;
  add: (productId: string) => Promise<boolean>;
  remove: (productId: string) => Promise<boolean>;
  /** Changes a starred product's alert rule. */
  setAlert: (productId: string, alert: WatchAlert) => Promise<boolean>;
  pending: boolean;
  error: unknown;
  clearError: () => void;
};

export function useWatchActions(): WatchActions {
  const account = useAccount();
  const client = useQueryClient();
  const accountId = account.status === "signed_in" ? account.account.id : "";
  const key = watchlistQueryKey(accountId);
  const patch = (update: (listing: Listing) => Listing) => client.setQueryData<Listing>(key, update(readListing(client, accountId)));

  const add = useMutation({
    mutationFn: (productId: string) => accountApi.watchlist.add(productId),
    onMutate: (productId) => {
      const previous = readListing(client, accountId);
      if (!previous.items.some((item) => item.product_id === productId)) {
        const stamp = new Date().toISOString();
        patch((listing) => ({ ...listing, items: [{ product_id: productId, alert: { mode: "any_drop", threshold_minor: null }, created_at: stamp, updated_at: stamp, last_alert_at: null, last_alert_minor: null, price: null }, ...listing.items] }));
      }
      return { previous };
    },
    onError: (_error, _productId, context) => {
      if (context) client.setQueryData(key, context.previous);
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: key }),
  });
  const remove = useMutation({
    mutationFn: (productId: string) => accountApi.watchlist.remove(productId),
    onMutate: (productId) => {
      const previous = readListing(client, accountId);
      patch((listing) => ({ ...listing, items: listing.items.filter((item) => item.product_id !== productId) }));
      return { previous };
    },
    onError: (_error, _productId, context) => {
      if (context) client.setQueryData(key, context.previous);
    },
  });
  const rule = useMutation({
    mutationFn: ({ productId, alert }: { productId: string; alert: WatchAlert }) => accountApi.watchlist.update(productId, alert),
    onMutate: ({ productId, alert }) => {
      const previous = readListing(client, accountId);
      patch((listing) => ({ ...listing, items: listing.items.map((item) => (item.product_id === productId ? { ...item, alert } : item)) }));
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context) client.setQueryData(key, context.previous);
    },
  });

  const settle = async (run: Promise<unknown>): Promise<boolean> => {
    try {
      await run;
      return true;
    } catch {
      return false;
    }
  };
  return {
    toggle: async (productId) => {
      if (!accountId) return null;
      const watched = readListing(client, accountId).items.some((item) => item.product_id === productId);
      const ok = await settle(watched ? remove.mutateAsync(productId) : add.mutateAsync(productId));
      return ok ? !watched : null;
    },
    add: (productId) => settle(add.mutateAsync(productId)),
    remove: (productId) => settle(remove.mutateAsync(productId)),
    setAlert: (productId, alert) => settle(rule.mutateAsync({ productId, alert })),
    pending: add.isPending || remove.isPending || rule.isPending,
    error: add.error ?? remove.error ?? rule.error,
    clearError: () => {
      add.reset();
      remove.reset();
      rule.reset();
    },
  };
}
