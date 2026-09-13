import { RiGoogleFill, RiKey2Line, RiMailCheckLine, RiMailCloseLine, RiUserFollowLine, RiUserForbidLine } from "@remixicon/react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { date, EmptyTableRow, PageFrame, Pagination, TableControls, useTableState } from "@/components/data-display";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, ApiError, listUrl, type AccountStatus, type AdminAccount, type AdminAccountUpdate, type Page } from "@/lib/api";
import { cn } from "@/lib/utils";

const statuses: Array<{ label: string; value: AccountStatus }> = [
  { label: "Active", value: "active" },
  { label: "Disabled", value: "disabled" },
];

/**
 * Who has an account on the public site, searchable by address or name, with what each keeps.
 * Disabling an account signs the person out everywhere and refuses their next sign-in; enabling
 * lets them back in. Nothing here shows a password or a token.
 */
export function AccountsPage() {
  const state = useTableState();
  const queryClient = useQueryClient();
  const accounts = useQuery({
    queryKey: ["accounts", state.page, state.pageSize, state.search, state.status],
    queryFn: ({ signal }) => api<Page<AdminAccount>>(listUrl("/v1/admin/accounts", state), { signal }),
    placeholderData: keepPreviousData,
  });
  const [pending, setPending] = useState<AdminAccount | null>(null);
  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: AccountStatus }) => api<AdminAccountUpdate>(`/v1/admin/accounts/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) }),
    onSuccess: () => {
      setPending(null);
      void queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
  const next: AccountStatus = pending?.status === "disabled" ? "active" : "disabled";

  return (
    <PageFrame eyebrow="Community" title="Accounts" description="People with an account on the public site, newest first: whether their address is verified, how they sign in, and how many menus and recipes they keep. Disable an account to sign the person out everywhere and refuse their sign-in until it is enabled again.">
      <Card>
        <CardContent className="p-0">
          <TableControls placeholder="Search by email or name…" state={state} statuses={statuses} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead className="w-28">Verified</TableHead>
                <TableHead className="hidden w-40 md:table-cell">Signs in with</TableHead>
                <TableHead className="w-20 text-right">Menus</TableHead>
                <TableHead className="w-20 text-right">Recipes</TableHead>
                <TableHead className="hidden w-40 lg:table-cell">Created</TableHead>
                <TableHead className="w-28 text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.isPending ? <TableRow><TableCell className="py-8 text-center text-sm text-muted-foreground" colSpan={7}>Loading accounts…</TableCell></TableRow> : null}
              {accounts.isError ? <TableRow><TableCell className="py-8 text-center text-sm text-destructive" colSpan={7}>{accounts.error instanceof ApiError ? accounts.error.message : "The accounts list did not load."}</TableCell></TableRow> : null}
              {accounts.data && !accounts.data.items.length ? <EmptyTableRow columns={7} /> : null}
              {(accounts.data?.items ?? []).map((account) => {
                const google = account.identities?.includes("google") || !account.has_password;
                const locked = account.locked_until !== null && Date.parse(account.locked_until) > Date.now();
                return (
                  <TableRow key={account.id} className={cn(account.status === "disabled" && "opacity-70")}>
                    <TableCell>
                      <a className="block truncate text-sm font-medium text-foreground hover:text-primary" href={`mailto:${account.email}`}>{account.email}</a>
                      <span className="block truncate text-xs text-muted-foreground">{account.display_name}{account.locale !== "en" ? ` · ${account.locale === "si" ? "සිංහල" : "தமிழ்"}` : ""}{locked ? " · locked after failed sign-ins" : ""}</span>
                    </TableCell>
                    <TableCell>
                      {account.email_verified_at ? (
                        <Badge className="gap-1" variant="default"><RiMailCheckLine className="size-3" />Verified</Badge>
                      ) : (
                        <Badge className="gap-1" variant="outline"><RiMailCloseLine className="size-3" />Not yet</Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {account.has_password ? <Badge className="gap-1" variant="secondary"><RiKey2Line className="size-3" />Password</Badge> : null}
                        {google ? <Badge className="gap-1" variant="secondary"><RiGoogleFill className="size-3" />Google</Badge> : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">{account.menus}</TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">{account.recipes}</TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">{date(account.created_at)}</TableCell>
                    <TableCell className="text-right">
                      {account.status === "disabled" ? (
                        <Button disabled={update.isPending} onClick={() => setPending(account)} size="sm" variant="outline"><RiUserFollowLine className="size-3.5" />Enable</Button>
                      ) : (
                        <Button disabled={update.isPending} onClick={() => setPending(account)} size="sm" variant="ghost"><RiUserForbidLine className="size-3.5" />Disable</Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {accounts.data ? <Pagination page={accounts.data.page} pageSize={accounts.data.pageSize} pages={Math.max(1, accounts.data.pages)} total={accounts.data.total} pending={accounts.isFetching} /> : null}
        </CardContent>
      </Card>

      <AlertDialog onOpenChange={(open) => { if (!open) { setPending(null); update.reset(); } }} open={pending !== null}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{next === "disabled" ? "Disable" : "Enable"} {pending?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              {next === "disabled"
                ? "The person is signed out on every device at once and cannot sign in again until the account is enabled. Their menus and recipes stay as they are."
                : "The person can sign in again with their password or Google, and everything they kept is still there."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {update.isError ? <p className="text-sm text-destructive" role="alert">{update.error instanceof ApiError ? update.error.message : "That did not save. Try again."}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it as it is</AlertDialogCancel>
            <AlertDialogAction
              disabled={update.isPending}
              onClick={(event) => {
                // Stays open until the API has answered, so a refusal shows here.
                event.preventDefault();
                if (pending) update.mutate({ id: pending.id, status: next });
              }}
            >
              {update.isPending ? "Saving…" : next === "disabled" ? "Disable account" : "Enable account"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageFrame>
  );
}
