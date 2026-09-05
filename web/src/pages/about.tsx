import { useQuery } from "@tanstack/react-query";

import { SellerMark } from "@/components/seller-mark";
import { Card, CardContent } from "@/components/ui/card";
import { fetchOverview } from "@/lib/api";

export function AboutPage() {
  const overview = useQuery({ queryKey: ["overview"], queryFn: fetchOverview });
  return (
    <article className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">About PriceLens</h1>
        <p className="mt-2 text-muted-foreground">Food prices across Sri Lanka's open markets and supermarkets, collected every day from official bulletins and store shelves, and kept with their history so a household can see what things cost, where they cost least, and which way they are moving.</p>
      </header>
      <Card>
        <CardContent className="space-y-3 p-5 text-sm leading-relaxed">
          <h2 className="font-heading text-lg font-semibold">How prices are collected</h2>
          <p>Official bulletins (PDF) are downloaded as published, archived unchanged, and parsed; every price keeps the page and row it came from. Supermarket shelf prices are captured from the retailers' online stores each morning. Product names are matched to a reviewed vocabulary, so “B'Onion Imported” in a bulletin and “Big Onions” on a shelf compare as the same thing; unknown names wait for review rather than being guessed.</p>
          <p>A price is shown with the date it was observed. Open-market prices come from surveys of selected markets and may differ at another stall on the same day. Supermarket prices are the online store's, which can differ from a branch.</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-3 p-5 text-sm">
          <h2 className="font-heading text-lg font-semibold">Sources</h2>
          <ul className="divide-y">
            {(overview.data?.sources ?? []).map((source) => (
              <li key={source.id} className="flex items-start gap-3 py-2.5">
                <SellerMark marketId={`market_${source.id.replace(/_online_prices$/u, "_online").replace(/_daily.*|_weekly.*/u, "")}`} label={source.name} type={source.kind === "supermarket" ? "online_store" : "wholesale_market"} size="sm" />
                <div className="min-w-0">
                  <a href={source.landing_url} rel="noreferrer" target="_blank" className="font-medium underline-offset-2 hover:underline">{source.name}</a>
                  <p className="text-xs text-muted-foreground">{source.publisher} · {source.cadence.replace("_", " ")}{source.attribution ? ` · ${source.attribution}` : ""}</p>
                </div>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">Each publisher has recorded permission for this use; their attribution accompanies their data.</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-2 p-5 text-sm">
          <h2 className="font-heading text-lg font-semibold">What is coming</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>Sinhala and Tamil names for every product.</li>
            <li>Price alerts when something you buy moves.</li>
            <li>What a dish costs to cook today, from a catalogue of Sri Lankan recipes, and a weekly plan for your budget.</li>
          </ul>
        </CardContent>
      </Card>
    </article>
  );
}
