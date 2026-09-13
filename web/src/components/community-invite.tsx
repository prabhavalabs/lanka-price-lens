import { RiCloseLine, RiDiscordFill } from "@remixicon/react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { trackEvent } from "@/lib/analytics";
import { inviteAfterMs, readInviteMemory, shouldInvite, writeInviteMemory, type Visit } from "@/lib/community";

/**
 * The community corner: a small button that is always there, and a card that opens a few seconds
 * after arriving to say what the Discord is for. The card is closable, comes back at most once a
 * month, and never again after a click through on either. Needs the invite url from the
 * deployment config; without one nothing renders.
 */
export function CommunityInvite({ url }: { url: string | null }) {
  const visit = useRef<Visit>({ startedAt: Date.now() });
  const [open, setOpen] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (!url || gone || open) return;
    const storage = typeof window === "undefined" ? undefined : window.localStorage;
    const check = () => {
      if (!shouldInvite(readInviteMemory(storage), visit.current, Date.now())) return;
      setOpen(true);
      trackEvent("community_invite", { action: "shown", page_path: window.location.pathname });
    };
    const elapsed = Date.now() - visit.current.startedAt;
    const timer = window.setTimeout(check, Math.max(0, inviteAfterMs - elapsed) + 50);
    return () => window.clearTimeout(timer);
  }, [url, gone, open]);

  if (!url) return null;
  const storage = window.localStorage;
  if (!open) {
    // Between cards (and after "not now"), a small button stays in the corner: the community is where updates land.
    const clickThrough = () => {
      writeInviteMemory(storage, { ...readInviteMemory(storage), joinedAt: Date.now() });
      trackEvent("community_invite", { action: "button" });
      setGone(true);
    };
    return (
      <a
        aria-label="Join the Prabhava Labs Discord community"
        className="fixed bottom-4 right-4 z-40 inline-flex h-11 items-center gap-2 rounded-full bg-[#5865F2] pl-3 pr-3 text-sm font-medium text-white no-underline shadow-lg shadow-[#5865F2]/30 transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-xl hover:shadow-[#5865F2]/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5865F2] focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none sm:bottom-6 sm:right-6 sm:pr-4"
        href={url}
        onClick={clickThrough}
        rel="noopener noreferrer"
        target="_blank"
      >
        <RiDiscordFill className="size-5" />
        <span className="hidden sm:inline">Join the community</span>
      </a>
    );
  }
  const dismiss = () => {
    writeInviteMemory(storage, { ...readInviteMemory(storage), dismissedAt: Date.now() });
    trackEvent("community_invite", { action: "dismiss" });
    setOpen(false);
    setGone(true);
  };
  const join = () => {
    writeInviteMemory(storage, { ...readInviteMemory(storage), joinedAt: Date.now() });
    trackEvent("community_invite", { action: "join" });
    setOpen(false);
    setGone(true);
  };

  return (
    <aside
      aria-label="Join the community"
      className="fixed inset-x-4 bottom-4 z-40 rounded-xl border bg-card p-4 text-card-foreground shadow-lg motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4 motion-safe:duration-300 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:max-w-sm"
      role="complementary"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#5865F2]/12 text-[#5865F2]"><RiDiscordFill className="size-5" /></span>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-heading text-sm font-semibold leading-tight">Built in the open</p>
          <p className="text-pretty text-xs leading-relaxed text-muted-foreground">
            The Prabhava Labs Discord is where PriceLens updates land first, alongside our other projects. Tell us what to fix, see what is coming. No email, no noise.
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1.5">
            <Button asChild size="sm"><a href={url} onClick={join} rel="noopener noreferrer" target="_blank"><RiDiscordFill className="size-4" />Join the Discord</a></Button>
            <Button onClick={dismiss} size="sm" variant="ghost">Not now</Button>
          </div>
        </div>
        <Button aria-label="Close" className="-mr-1 -mt-1 shrink-0" onClick={dismiss} size="icon-sm" variant="ghost"><RiCloseLine className="size-4" /></Button>
      </div>
    </aside>
  );
}
