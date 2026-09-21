import { useState } from "react";
import { RiAddLine, RiFileCopyLine, RiKey2Line, RiTerminalBoxLine } from "@remixicon/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { date, EmptyTableRow, PageFrame } from "@/components/data-display";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiError, tokensApi, type AdminToken } from "@/lib/api";

const message = (error: unknown, fallback: string): string => (error instanceof ApiError ? error.message : fallback);

/** How a token is put to work, ready to paste. The value is filled in only while it is on screen. */
const claudeConfig = (token: string, origin: string) =>
  JSON.stringify({ mcpServers: { "lanka-pricelens": { command: "node", args: ["<path to the repository>/mcp/src/server.ts"], env: { LPL_MCP_TOKEN: token, LPL_MCP_ORIGIN: origin, LPL_MCP_WRITE: "1" } } } }, null, 2);

/** Tokens that let a program act as the owner: the MCP server, a script, a scheduled job. */
export function AgentAccessPage() {
  const queryClient = useQueryClient();
  const tokens = useQuery({ queryKey: ["tokens"], queryFn: ({ signal }) => tokensApi.list({ signal }) });
  const [name, setName] = useState("");
  const [scope, setScope] = useState<AdminToken["scope"]>("distribution");
  const [days, setDays] = useState("");
  const [made, setMade] = useState<{ token: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const origin = typeof window === "undefined" ? "https://admin.badumila.com" : window.location.origin;
  const create = useMutation({
    mutationFn: () => tokensApi.create({ name: name.trim(), scope, ...(days.trim() ? { days: Number(days) } : {}) }),
    onSuccess: (data) => {
      setMade({ token: data.token });
      setName("");
      setDays("");
      queryClient.setQueryData(["tokens"], data.tokens);
    },
  });
  const revoke = useMutation({ mutationFn: (id: string) => tokensApi.revoke(id), onSuccess: (rows) => queryClient.setQueryData(["tokens"], rows) });

  const copy = (what: string, value: string) => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(what);
      window.setTimeout(() => setCopied(null), 2000);
    });
  };

  const state = (token: AdminToken): { label: string; variant: "default" | "secondary" | "destructive" | "outline" } => {
    if (token.revoked_at) return { label: "Revoked", variant: "destructive" };
    if (token.expires_at && new Date(token.expires_at) <= new Date()) return { label: "Expired", variant: "outline" };
    return { label: "Live", variant: "default" };
  };

  return (
    <PageFrame
      description="Tokens that let a program act as you: the MCP server in Claude Code or Codex, a script, a scheduled job. A token is shown once when it is made and kept only as a hash, so it cannot be read back out of here."
      eyebrow="Distribution channels"
      title="Agent access"
    >
      {made ? (
        <Alert>
          <AlertTitle className="flex items-center gap-2"><RiKey2Line className="size-4" />Copy it now</AlertTitle>
          <AlertDescription className="grid gap-3">
            <p>This is the only time the token is shown. If it is lost, revoke it and make another.</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1.5 font-mono text-xs text-foreground">{made.token}</code>
              <Button onClick={() => copy("token", made.token)} size="sm" variant="outline"><RiFileCopyLine className="size-3.5" />{copied === "token" ? "Copied" : "Copy"}</Button>
            </div>
            <div className="grid gap-1.5">
              <p className="flex items-center gap-1.5 text-xs font-medium"><RiTerminalBoxLine className="size-3.5" />For Claude Code or Codex, in its MCP configuration:</p>
              <pre className="max-h-56 overflow-auto rounded-lg border bg-background/40 p-2.5 font-mono text-[11px] leading-relaxed">{claudeConfig(made.token, origin)}</pre>
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => copy("config", claudeConfig(made.token, origin))} size="sm" variant="outline"><RiFileCopyLine className="size-3.5" />{copied === "config" ? "Copied" : "Copy the configuration"}</Button>
                <Button onClick={() => setMade(null)} size="sm" variant="ghost">I have it</Button>
              </div>
              <p className="text-xs text-muted-foreground">Leave out <code className="font-mono">LPL_MCP_WRITE</code> to give the agent a server that can read the library but change nothing.</p>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>A new token</CardTitle>
          <CardDescription>Name it after where it will live, so you know later what revoking it would break.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_10rem_auto] sm:items-end">
            <div className="grid gap-1.5">
              <Label htmlFor="token-name">Name</Label>
              <Input id="token-name" onChange={(event) => setName(event.target.value)} placeholder="Claude Code on the MacBook" value={name} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="token-scope">Reaches</Label>
              <Select onValueChange={(value) => setScope(value as AdminToken["scope"])} value={scope}>
                <SelectTrigger id="token-scope"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="distribution">Distribution only</SelectItem>
                  <SelectItem value="full">The whole admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="token-days">Ends after</Label>
              <Input id="token-days" min={1} onChange={(event) => setDays(event.target.value)} placeholder="days (optional)" type="number" value={days} />
            </div>
            <Button disabled={create.isPending || !name.trim()} onClick={() => create.mutate()}><RiAddLine className="size-4" />{create.isPending ? "Making…" : "Make a token"}</Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {scope === "distribution"
              ? "The library, the calendar and the channels. It cannot read the prices, the accounts or the sources, and it cannot make another token."
              : "Everything your own sign-in can reach, apart from making tokens. Only give this out when something genuinely needs it."}
          </p>
          {create.isError ? <p className="text-sm text-destructive" role="alert">{message(create.error, "That token was not made.")}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Tokens</CardTitle><CardDescription>A token that has never been used, or has not been used in a long time, is one to revoke.</CardDescription></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead className="w-36">Reaches</TableHead><TableHead className="w-24">State</TableHead><TableHead className="w-44">Last used</TableHead><TableHead className="w-44">Made</TableHead><TableHead className="w-24" /></TableRow></TableHeader>
            <TableBody>
              {tokens.data && !tokens.data.length ? <EmptyTableRow columns={6} /> : null}
              {(tokens.data ?? []).map((token) => {
                const shown = state(token);
                return (
                  <TableRow key={token.id}>
                    <TableCell className="text-sm font-medium">{token.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{token.scope === "full" ? "The whole admin" : "Distribution"}</TableCell>
                    <TableCell><Badge variant={shown.variant}>{shown.label}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{token.last_used_at ? date(token.last_used_at) : "never"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{date(token.created_at)}</TableCell>
                    <TableCell className="text-right">
                      {token.revoked_at ? null : <Button disabled={revoke.isPending} onClick={() => revoke.mutate(token.id)} size="sm" variant="ghost">Revoke</Button>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </PageFrame>
  );
}
