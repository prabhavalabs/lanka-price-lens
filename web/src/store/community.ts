import type { ProductProposal, ReactionValue, RecipeScore, RecipeSubmission, TranslationFeedback } from "@lanka-pricelens/shared";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { accountApi, AccountApiError, type OwnReaction, type ReactionAnswer } from "../lib/account-api.ts";
import type { RecipeDetail, RecipeQueryList } from "../lib/api.ts";
import { applyReaction, shiftScore, type SentTranslation } from "../lib/contributions.ts";
import { useAccount } from "./account.ts";

/**
 * What the signed-in person has given back on the recipes: their thumbs, their requests and
 * submitted recipes, and the ingredients they proposed. Each is one query on the account. A
 * thumb is applied to the cached copy first, and to the dish's score wherever it is on screen
 * (its page, the recipe cards), then sent; the server's counts replace the guess when they
 * arrive, and a refusal puts everything back.
 */

export const reactionsQueryKey = (accountId: string) => ["account", "community", "reactions", accountId] as const;
export const submissionsQueryKey = (accountId: string) => ["account", "community", "submissions", accountId] as const;
export const proposalsQueryKey = (accountId: string) => ["account", "community", "proposals", accountId] as const;
/** Translation feedback sent this visit; the API has no route to list it back, so the site remembers what it sent. */
export const translationsQueryKey = (accountId: string) => ["account", "community", "translations", accountId] as const;

export type CommunityStatus = "loading" | "ready" | "error" | "signed_out";

type Reactions = Record<string, OwnReaction>;

function useAccountId(): string {
  const account = useAccount();
  return account.status === "signed_in" ? account.account.id : "";
}

/** Signed out mid-flight, or not verified yet, reads as nothing sent rather than a failure. */
function orNothing<T>(fallback: T): (error: unknown) => T {
  return (error) => {
    if (error instanceof AccountApiError && (error.status === 401 || error.code === "EMAIL_NOT_VERIFIED")) return fallback;
    throw error;
  };
}

function readReactions(client: QueryClient, accountId: string): Reactions {
  return client.getQueryData<Reactions>(reactionsQueryKey(accountId)) ?? {};
}

/** The account's thumbs, keyed by dish; empty while signed out. */
export function useReactions(): { reactions: Reactions; status: CommunityStatus } {
  const account = useAccount();
  const accountId = account.status === "signed_in" ? account.account.id : "";
  const query = useQuery({
    queryKey: reactionsQueryKey(accountId),
    queryFn: ({ signal }) => accountApi.community.reactions.list(signal).catch(orNothing<Reactions>({})),
    enabled: Boolean(accountId),
    staleTime: 5 * 60_000,
  });
  if (account.status === "signed_out") return { reactions: {}, status: "signed_out" };
  if (account.status === "loading" || query.isPending) return { reactions: {}, status: "loading" };
  if (query.isError && !query.data) return { reactions: {}, status: "error" };
  return { reactions: query.data ?? {}, status: "ready" };
}

/** The account's thumb on one dish, or null. */
export function useReaction(dishId: string): { value: OwnReaction | null; status: CommunityStatus } {
  const { reactions, status } = useReactions();
  return { value: reactions[dishId] ?? null, status };
}

/** Writes a dish's counts wherever the cache holds them: its page at any headcount, and every recipes list page. */
function patchScore(client: QueryClient, dishId: string, counts: (score: RecipeScore) => RecipeScore, score: (current: number) => number): void {
  client.setQueriesData<RecipeDetail>({ queryKey: ["recipe", dishId] }, (detail) => (detail ? { ...detail, reactions: counts(detail.reactions) } : detail));
  client.setQueriesData<RecipeQueryList>({ queryKey: ["recipes-query"] }, (list) => {
    if (!list?.items.some((item) => item.dish.id === dishId)) return list;
    return { ...list, items: list.items.map((item) => (item.dish.id === dishId ? { ...item, score: score(item.score) } : item)) };
  });
}

type ReactionSnapshot = { reactions: Reactions; details: Array<[readonly unknown[], RecipeDetail | undefined]>; lists: Array<[readonly unknown[], RecipeQueryList | undefined]> };

export type ReactActions = {
  /** Sets, switches, or removes ("none") the account's thumb on a dish; answers whether the server took it. */
  react: (dishId: string, value: ReactionValue) => Promise<boolean>;
  pending: boolean;
  error: unknown;
  clearError: () => void;
};

export function useReact(): ReactActions {
  const client = useQueryClient();
  const accountId = useAccountId();
  const key = reactionsQueryKey(accountId);
  const mutation = useMutation({
    mutationFn: ({ dishId, value }: { dishId: string; value: ReactionValue }) => accountApi.community.reactions.set(dishId, value),
    onMutate: async ({ dishId, value }): Promise<ReactionSnapshot> => {
      await client.cancelQueries({ queryKey: key });
      const reactions = readReactions(client, accountId);
      const previous = reactions[dishId] ?? null;
      const snapshot: ReactionSnapshot = { reactions, details: client.getQueriesData<RecipeDetail>({ queryKey: ["recipe", dishId] }), lists: client.getQueriesData<RecipeQueryList>({ queryKey: ["recipes-query"] }) };
      const next = { ...reactions };
      if (value === "none") delete next[dishId];
      else next[dishId] = value;
      client.setQueryData<Reactions>(key, next);
      patchScore(client, dishId, (counts) => applyReaction(counts, previous, value), (score) => shiftScore(score, previous, value));
      return snapshot;
    },
    onError: (_error, _input, snapshot) => {
      if (!snapshot) return;
      client.setQueryData<Reactions>(key, snapshot.reactions);
      for (const [queryKey, data] of snapshot.details) client.setQueryData(queryKey, data);
      for (const [queryKey, data] of snapshot.lists) client.setQueryData(queryKey, data);
    },
    onSuccess: (answer: ReactionAnswer, { dishId }) => {
      client.setQueryData<Reactions>(key, (current) => {
        const next = { ...(current ?? {}) };
        if (answer.value === "none") delete next[dishId];
        else next[dishId] = answer.value;
        return next;
      });
      const counts: RecipeScore = { likes: answer.likes, dislikes: answer.dislikes, score: answer.score };
      patchScore(client, dishId, () => counts, () => counts.score);
    },
  });
  return {
    react: async (dishId, value) => {
      if (!accountId) return false;
      try {
        await mutation.mutateAsync({ dishId, value });
        return true;
      } catch {
        return false;
      }
    },
    pending: mutation.isPending,
    error: mutation.error,
    clearError: () => mutation.reset(),
  };
}

export type SubmissionsResult = { submissions: RecipeSubmission[]; status: CommunityStatus; error: unknown; refetch: () => void };

/** The account's requests and submitted recipes, newest first; empty while signed out. */
export function useSubmissions(): SubmissionsResult {
  const account = useAccount();
  const accountId = account.status === "signed_in" ? account.account.id : "";
  const query = useQuery({
    queryKey: submissionsQueryKey(accountId),
    queryFn: ({ signal }) => accountApi.community.submissions.list(signal).catch(orNothing<RecipeSubmission[]>([])),
    enabled: Boolean(accountId),
    staleTime: 60_000,
  });
  const refetch = () => void query.refetch();
  if (account.status === "signed_out") return { submissions: [], status: "signed_out", error: null, refetch };
  if (account.status === "loading" || query.isPending) return { submissions: [], status: "loading", error: null, refetch };
  if (query.isError && !query.data) return { submissions: [], status: "error", error: query.error, refetch };
  return { submissions: query.data ?? [], status: "ready", error: null, refetch };
}

export type ProposalsResult = { proposals: ProductProposal[]; status: CommunityStatus; error: unknown; refetch: () => void };

/** The ingredients the account proposed, newest first; empty while signed out. */
export function useProposals(): ProposalsResult {
  const account = useAccount();
  const accountId = account.status === "signed_in" ? account.account.id : "";
  const query = useQuery({
    queryKey: proposalsQueryKey(accountId),
    queryFn: ({ signal }) => accountApi.community.products.list(signal).catch(orNothing<ProductProposal[]>([])),
    enabled: Boolean(accountId),
    staleTime: 60_000,
  });
  const refetch = () => void query.refetch();
  if (account.status === "signed_out") return { proposals: [], status: "signed_out", error: null, refetch };
  if (account.status === "loading" || query.isPending) return { proposals: [], status: "loading", error: null, refetch };
  if (query.isError && !query.data) return { proposals: [], status: "error", error: query.error, refetch };
  return { proposals: query.data ?? [], status: "ready", error: null, refetch };
}

/** A dish name from its id when the page has not seen the dish itself: "dish_pol_sambol" reads "Pol sambol". */
function nameFromId(dishId: string): string {
  const words = dishId.replace(/^dish_/u, "").replace(/_/gu, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The account's translation feedback, newest first; names come from the page that sent them when it is still open, else from the id. */
export function useSentTranslations(): SentTranslation[] {
  const accountId = useAccountId();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: translationsQueryKey(accountId),
    queryFn: async ({ signal }): Promise<SentTranslation[]> => {
      const known = new Map((client.getQueryData<SentTranslation[]>(translationsQueryKey(accountId)) ?? []).map((entry) => [entry.id, entry.dish_name]));
      try {
        return (await accountApi.community.translations.list(signal)).map((feedback) => ({ ...feedback, dish_name: known.get(feedback.id) ?? nameFromId(feedback.dish_id) }));
      } catch (error) {
        if (error instanceof AccountApiError && error.status === 401) return [];
        throw error;
      }
    },
    staleTime: 60_000,
    enabled: Boolean(accountId),
  });
  return accountId ? (query.data ?? []) : [];
}

// After a contribution is accepted, the cached lists learn it at once; the next visit reads it from the server.

/** Puts a newly accepted request or recipe submission at the top of the account's list. */
export function rememberSubmission(client: QueryClient, accountId: string, submission: RecipeSubmission): void {
  client.setQueryData<RecipeSubmission[]>(submissionsQueryKey(accountId), (current) => [submission, ...(current ?? []).filter((entry) => entry.id !== submission.id)]);
}

export function rememberProposal(client: QueryClient, accountId: string, proposal: ProductProposal): void {
  client.setQueryData<ProductProposal[]>(proposalsQueryKey(accountId), (current) => [proposal, ...(current ?? []).filter((entry) => entry.id !== proposal.id)]);
}

export function forgetTranslation(client: QueryClient, accountId: string, id: string): void {
  client.setQueryData<SentTranslation[]>(translationsQueryKey(accountId), (current) => (current ?? []).filter((entry) => entry.id !== id));
}

export function rememberTranslation(client: QueryClient, accountId: string, feedback: TranslationFeedback, dishName: string): void {
  client.setQueryData<SentTranslation[]>(translationsQueryKey(accountId), (current) => [{ ...feedback, dish_name: dishName }, ...(current ?? []).filter((entry) => entry.id !== feedback.id)]);
}
