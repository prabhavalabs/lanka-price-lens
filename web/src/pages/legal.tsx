import { contactAddress, privacyPolicy, termsOfUse, type LegalDocument } from "@/content/legal";
import { usePageTitle } from "@/lib/page-title";

const updatedFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });

/** One long-form page for the small print: a heading, when it last changed, and plain sections. */
function LegalPage({ document }: { document: LegalDocument }) {
  usePageTitle(document.pageTitle);
  return (
    <article className="mx-auto max-w-3xl space-y-8">
      <header className="space-y-2">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">{document.title}</h1>
        <p className="text-sm text-muted-foreground">Last updated {updatedFormat.format(new Date(`${document.updated}T00:00:00Z`))}.</p>
        <p className="text-pretty text-muted-foreground">{document.intro}</p>
      </header>
      {document.sections.map((section) => {
        const paragraphs = section.body.filter((line) => !line.startsWith("- "));
        const bullets = section.body.filter((line) => line.startsWith("- ")).map((line) => line.slice(2));
        return (
          <section className="space-y-2" key={section.heading}>
            <h2 className="font-heading text-lg font-semibold">{section.heading}</h2>
            {bullets.length ? (
              <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed">
                {bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
              </ul>
            ) : null}
            {paragraphs.map((paragraph) => <p className="text-pretty text-sm leading-relaxed" key={paragraph}>{paragraph}</p>)}
          </section>
        );
      })}
      <footer className="border-t pt-4 text-sm text-muted-foreground">
        Questions? Write to <a className="underline underline-offset-2" href={`mailto:${contactAddress}`}>{contactAddress}</a>. PriceLens, by Prabhava Labs.
      </footer>
    </article>
  );
}

export function PrivacyPage() {
  return <LegalPage document={privacyPolicy} />;
}

export function TermsPage() {
  return <LegalPage document={termsOfUse} />;
}
