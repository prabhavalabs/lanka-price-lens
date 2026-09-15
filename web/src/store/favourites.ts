import type { FavouriteEntry } from "@lanka-pricelens/shared";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { accountApi, AccountApiError } from "../lib/account-api.ts";
import { useAccount } from "./account.ts";

/**
 * Favourite recipes on the account: one query shared by every heart on the page, updated in
 * place when a heart is pressed so the change shows before the server answers.
 */

export const favouritesQueryKey = (accountId: string) => ["account", "favourites", accountId] as const;

export type FavouritesStatus = "loading" | "ready" | "error" | "signed_out";
export type FavouritesResult = { items: FavouriteEntry[]; status: FavouritesStatus; error: unknown; refetch: () => void };

function readItems(client: QueryClient, accountId: string): FavouriteEntry[] {
  return client.getQueryData<FavouriteEntry[]>(favouritesQueryKey(accountId)) ?? [];
}

/** The signed-in person's favourites; empty while signed out. */
export function useFavourites(): FavouritesResult {
  const account = useAccount();
  const accountId = account.status === "signed_in" ? account.account.id : "";
  const query = useQuery({
    queryKey: favouritesQueryKey(accountId),
    queryFn: async ({ signal }): Promise<FavouriteEntry[]> => {
      try {
        return (await accountApi.favourites.list(signal)).items;
      } catch (error) {
        if (error instanceof AccountApiError && error.status === 401) return [];
        throw error;
      }
    },
    enabled: Boolean(accountId),
    staleTime: 60_000,
  });
  const refetch = () => void query.refetch();
  if (account.status === "signed_out") return { items: [], status: "signed_out", error: null, refetch };
  if (account.status === "loading" || query.isPending) return { items: [], status: "loading", error: null, refetch };
  if (query.isError && !query.data) return { items: [], status: "error", error: query.error, refetch };
  return { items: query.data ?? [], status: "ready", error: null, refetch };
}

/** Whether one dish is a favourite. */
export function useFavourite(dishId: string): { favourite: boolean; status: FavouritesStatus } {
  const { items, status } = useFavourites();
  return { favourite: items.some((item) => item.dish_id === dishId), status };
}

export type FavouriteActions = {
  /** Hearts or unhearts a dish; answers the new state, or null when the server refused. */
  toggle: (dishId: string) => Promise<boolean | null>;
  remove: (dishId: string) => Promise<boolean>;
  pending: boolean;
  error: unknown;
  clearError: () => void;
};

export function useFavouriteActions(): FavouriteActions {
  const account = useAccount();
  const client = useQueryClient();
  const accountId = account.status === "signed_in" ? account.account.id : "";
  const key = favouritesQueryKey(accountId);

  const add = useMutation({
    mutationFn: (dishId: string) => accountApi.favourites.add(dishId),
    onMutate: (dishId) => {
      const previous = readItems(client, accountId);
      if (!previous.some((item) => item.dish_id === dishId)) client.setQueryData<FavouriteEntry[]>(key, [{ dish_id: dishId, created_at: new Date().toISOString(), dish: null }, ...previous]);
      return { previous };
    },
    onError: (_error, _dishId, context) => {
      if (context) client.setQueryData(key, context.previous);
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: key }),
  });
  const remove = useMutation({
    mutationFn: (dishId: string) => accountApi.favourites.remove(dishId),
    onMutate: (dishId) => {
      const previous = readItems(client, accountId);
      client.setQueryData<FavouriteEntry[]>(key, previous.filter((item) => item.dish_id !== dishId));
      return { previous };
    },
    onError: (_error, _dishId, context) => {
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
    toggle: async (dishId) => {
      if (!accountId) return null;
      const favourite = readItems(client, accountId).some((item) => item.dish_id === dishId);
      const ok = await settle(favourite ? remove.mutateAsync(dishId) : add.mutateAsync(dishId));
      return ok ? !favourite : null;
    },
    remove: (dishId) => settle(remove.mutateAsync(dishId)),
    pending: add.isPending || remove.isPending,
    error: add.error ?? remove.error,
    clearError: () => {
      add.reset();
      remove.reset();
    },
  };
}
