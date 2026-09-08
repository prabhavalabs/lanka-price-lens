import { RiCloseLine, RiDiscordFill } from "@remixicon/react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { trackEvent } from "@/lib/analytics";
import { inviteAfterMs, readInviteMemory, shouldInvite, writeInviteMemory, type Visit } from "@/lib/community";

/**
 * A small card, bottom corner, inviting the visitor to the community Discord a few seconds after
 * they arrive. Closable; at most once a month; never again after they click through. Needs the
 * invite url from the deployment config; without one it renders nothing.
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

  if (!url || !open) return null;
  const storage = window.localStorage;
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
