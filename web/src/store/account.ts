import type { AccountProfile } from "@lanka-pricelens/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { accountApi, AccountApiError } from "@/lib/account-api";

/**
 * Who is signed in, for the whole site. One query against /v1/account/me, shared by every
 * component; sign-in and sign-out invalidate it. Signed out is a normal state (a 401), not an
 * error.
 */
export type AccountState = { status: "loading" } | { status: "signed_out" } | { status: "signed_in"; account: AccountProfile };

export const accountQueryKey = ["account", "me"] as const;

export function useAccount(): AccountState & { refresh: () => Promise<void> } {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: accountQueryKey,
    queryFn: async ({ signal }) => {
      try {
        return await accountApi.me(signal);
      } catch (error) {
        if (error instanceof AccountApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: accountQueryKey });
  };
  if (query.isPending) return { status: "loading", refresh };
  if (query.data) return { status: "signed_in", account: query.data, refresh };
  return { status: "signed_out", refresh };
}

/** After sign-in, registration, or a profile change: put the fresh profile in place at once. */
export function setAccountProfile(client: ReturnType<typeof useQueryClient>, profile: AccountProfile | null): void {
  client.setQueryData(accountQueryKey, profile);
}
