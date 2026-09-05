import { RiInformationLine, RiLightbulbLine } from "@remixicon/react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { FeedbackDialog } from "@/components/feedback-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { guideSections, type GuideFigure, type GuideSection } from "@/content/guide";
import { cn } from "@/lib/utils";

const sectionIds = guideSections.map((section) => section.id);

/** The section whose heading is nearest the top of the viewport, for the "on this page" list. */
function useActiveSection(): string {
  const [active, setActive] = useState(sectionIds[0] ?? "");
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top)[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: "-15% 0px -70% 0px" },
    );
    for (const id of sectionIds) {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, []);
  return active;
}

export function GuidePage() {
  const location = useLocation();
  const active = useActiveSection();
  // The app renders after the page loads, so a link to a section has to scroll once the sections exist.
  useEffect(() => {
    const id = location.hash.replace(/^#/u, "");
    if (id) document.getElementById(id)?.scrollIntoView();
  }, [location.hash]);

  return (
    <div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-12">
      <aside className="hidden lg:block">
        <nav aria-label="On this page" className="sticky top-24 space-y-0.5 border-l text-sm">
          {guideSections.map((section, index) => (
            <a
              className={cn("-ml-px block border-l py-1.5 pl-4 text-muted-foreground no-underline transition-colors hover:text-foreground", active === section.id && "border-primary font-medium text-foreground")}
              href={`#${section.id}`}
              key={section.id}
            >
              <span className="mr-2 text-[11px] tabular-nums text-muted-foreground/70">{index + 1}</span>
              {section.title}
            </a>
          ))}
        </nav>
      </aside>

      <article className="max-w-3xl space-y-14">
        <header className="space-y-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-primary">Guide</p>
          <h1 className="text-balance font-heading text-3xl font-semibold tracking-tight sm:text-4xl">How to use PriceLens</h1>
          <p className="max-w-2xl text-pretty text-muted-foreground">
            Five minutes from the front page to a priced shopping list and a dish to cook from it. Everything here works the same on a phone, and nothing needs an account.
          </p>
          <ol className="flex flex-wrap gap-1.5 lg:hidden">
            {guideSections.map((section, index) => (
              <li key={section.id}>
                <a className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs no-underline hover:border-primary/60 hover:text-primary" href={`#${section.id}`}>
                  <span className="tabular-nums text-muted-foreground">{index + 1}</span>
                  {section.title}
                </a>
              </li>
            ))}
          </ol>
        </header>

        {guideSections.map((section, index) => <Section index={index + 1} key={section.id} section={section} />)}

        <Card>
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-heading text-lg font-semibold">Something unclear or not working?</h2>
              <p className="mt-1 text-sm text-muted-foreground">Send a note from any page; it arrives with the page you were on. Where the prices come from and how they are matched is on the About page.</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <FeedbackDialog trigger={<Button size="sm">Send feedback</Button>} />
              <Button asChild size="sm" variant="outline"><Link to="/about"><RiInformationLine className="size-4" />About the data</Link></Button>
            </div>
          </CardContent>
        </Card>
      </article>
    </div>
  );
}

function Section({ section, index }: { section: GuideSection; index: number }) {
  return (
    <section aria-labelledby={`${section.id}-title`} className="scroll-mt-24 space-y-5" id={section.id}>
      <div className="space-y-2">
        <h2 className="flex items-baseline gap-3 font-heading text-2xl font-semibold tracking-tight" id={`${section.id}-title`}>
          <span className="text-base tabular-nums text-muted-foreground">{String(index).padStart(2, "0")}</span>
          {section.title}
        </h2>
        <p className="text-pretty text-muted-foreground">{section.summary}</p>
      </div>
      <ol className="space-y-2.5">
        {section.steps.map((step, position) => (
          <li className="flex gap-3 text-sm leading-relaxed" key={step}>
            <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold tabular-nums text-primary">{position + 1}</span>
            <p>{step}</p>
          </li>
        ))}
      </ol>
      {section.figures.length ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {section.figures.map((figure) => <Figure figure={figure} key={figure.file} />)}
        </div>
      ) : null}
      {section.tips?.length ? (
        <aside className="flex gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">
          <RiLightbulbLine className="mt-0.5 size-4 shrink-0 text-primary" />
          <ul className="space-y-1.5">
            {section.tips.map((tip) => <li key={tip}>{tip}</li>)}
          </ul>
        </aside>
      ) : null}
    </section>
  );
}

function Figure({ figure }: { figure: GuideFigure }) {
  return (
    <figure className={cn("m-0 overflow-hidden rounded-xl border bg-card shadow-sm", !figure.half && "sm:col-span-2")}>
      <img alt={figure.alt} className="block w-full" decoding="async" height={figure.height} loading="lazy" src={`/guide/${figure.file}.png`} width={figure.width} />
      <figcaption className="border-t px-3.5 py-2 text-xs leading-relaxed text-muted-foreground">{figure.caption}</figcaption>
    </figure>
  );
}
