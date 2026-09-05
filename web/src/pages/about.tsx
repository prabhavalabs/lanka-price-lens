import { useQuery } from "@tanstack/react-query";

import { fetchOverview } from "../lib/api.ts";

export function AboutPage() {
  const overview = useQuery({ queryKey: ["overview"], queryFn: fetchOverview });
  return (
    <article className="prose prose-sm max-w-none space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">About PriceLens</h1>
        <p className="text-ink-soft">Food prices across Sri Lanka's open markets and supermarkets, collected every day from official bulletins and store shelves, and kept with their history.</p>
      </header>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">How prices are collected</h2>
        <p>Official bulletins (PDF) are downloaded as published, archived unchanged, and parsed; every price keeps the page and row it came from. Supermarket shelf prices are captured from the retailers' online stores each morning. Product names are matched to a reviewed vocabulary, so “B'Onion Imported” in a bulletin and “Big Onions” on a shelf compare as the same thing; unknown names wait for review rather than being guessed.</p>
        <p>A price is shown with the date it was observed. Open-market prices come from surveys of selected markets and may differ at another stall on the same day. Supermarket prices are the online store's, which can differ from a branch.</p>
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Sources</h2>
        <ul className="list-disc pl-5 space-y-1">
          {(overview.data?.sources ?? []).map((source) => (
            <li key={source.id}>
              <a href={source.landing_url} rel="noreferrer" target="_blank" className="underline">{source.name}</a> — {source.publisher}, {source.cadence.replace("_", " ")}.
              {source.attribution ? <span className="text-ink-soft"> {source.attribution}</span> : null}
            </li>
          ))}
        </ul>
        <p className="text-ink-soft text-xs">Each publisher has recorded permission for this use; their attribution accompanies their data.</p>
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">What is coming</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Sinhala and Tamil names for every product.</li>
          <li>Your basket: pick what you buy and see where it costs least this week.</li>
          <li>What a dish costs to cook today, from a catalogue of Sri Lankan recipes.</li>
        </ul>
      </section>
    </article>
  );
}
