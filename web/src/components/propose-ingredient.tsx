import { proposalUnitHints, type ProductProposal, type ProductProposalInput } from "@lanka-pricelens/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { accountApi } from "@/lib/account-api";
import { describeContributionError } from "@/lib/contributions";
import { useAccount } from "@/store/account";
import { rememberProposal } from "@/store/community";

/** The kinds the site already files ingredients under, plus spices, which the registry keeps apart. */
const kinds = ["vegetables", "fruits", "grain", "fish", "meat", "dairy", "spices", "other"] as const;
type Kind = (typeof kinds)[number];
const kindWords: Record<Kind, string> = { vegetables: "Vegetables", fruits: "Fruits", grain: "Grain and flour", fish: "Fish and seafood", meat: "Meat and eggs", dairy: "Dairy", spices: "Spices and seasoning", other: "Other" };
const isKind = (value: string): value is Kind => (kinds as readonly string[]).includes(value);

type UnitHint = (typeof proposalUnitHints)[number];
type UnitChoice = UnitHint | "unsure";
const unitWords: Record<UnitHint, string> = { kg: "Kilograms", g: "Grams", l: "Litres", ml: "Millilitres", piece: "Pieces" };
const isUnitChoice = (value: string): value is UnitChoice => value === "unsure" || (proposalUnitHints as readonly string[]).includes(value);

/**
 * A small form for an ingredient the registry does not carry: its name, what kind of thing it
 * is, what it is measured in, and a note. On send the proposal goes to the owner and the
 * caller gets it back to put the line in the recipe. Mount it with a key of the typed name so
 * every opening starts fresh.
 */
export function ProposeIngredientDialog({ label, open, onOpenChange, onProposed }: { label: string; open: boolean; onOpenChange: (open: boolean) => void; onProposed: (proposal: ProductProposal) => void }) {
  const client = useQueryClient();
  const account = useAccount();
  const [name, setName] = useState(label);
  const [kind, setKind] = useState<Kind>("other");
  const [unit, setUnit] = useState<UnitChoice>("unsure");
  const [note, setNote] = useState("");
  const accountId = account.status === "signed_in" ? account.account.id : "";
  const send = useMutation({
    mutationFn: (input: ProductProposalInput) => accountApi.community.products.send(input),
    onSuccess: (proposal) => {
      rememberProposal(client, accountId, proposal);
      onProposed(proposal);
      onOpenChange(false);
    },
  });
  const ready = name.trim().length >= 2;
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-md">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready) return;
            send.mutate({ label: name.trim(), category: kind, unit_hint: unit === "unsure" ? null : unit, note: note.trim() || null });
          }}
        >
          <DialogHeader>
            <DialogTitle>Propose a new ingredient</DialogTitle>
            <DialogDescription>The registry does not carry it yet. Say what it is and the owner adds it with its nutrition and, where a store sells it, its price. Your recipe keeps the name as written until then.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="proposal-label">Ingredient</Label>
            <Input autoFocus id="proposal-label" maxLength={120} onChange={(event) => setName(event.target.value)} required value={name} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="proposal-kind">Kind</Label>
              <Select onValueChange={(value) => { if (isKind(value)) setKind(value); }} value={kind}>
                <SelectTrigger className="w-full" id="proposal-kind"><SelectValue /></SelectTrigger>
                <SelectContent position="popper">{kinds.map((entry) => <SelectItem key={entry} value={entry}>{kindWords[entry]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="proposal-unit">Usually measured in</Label>
              <Select onValueChange={(value) => { if (isUnitChoice(value)) setUnit(value); }} value={unit}>
                <SelectTrigger className="w-full" id="proposal-unit"><SelectValue /></SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="unsure">Not sure</SelectItem>
                  {proposalUnitHints.map((entry) => <SelectItem key={entry} value={entry}>{unitWords[entry]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="proposal-note">Note <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Textarea id="proposal-note" maxLength={1000} onChange={(event) => setNote(event.target.value)} placeholder="Another name for it, where it is sold, what it goes into." rows={3} value={note} />
          </div>
          {send.isError ? <p className="text-sm text-destructive" role="alert">{describeContributionError(send.error)}</p> : null}
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)} type="button" variant="ghost">Cancel</Button>
            <Button disabled={send.isPending || !ready} type="submit">{send.isPending ? "Sending…" : "Propose and add"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
