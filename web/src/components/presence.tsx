import { usePresence } from "@/hooks/use-presence";

/** A quiet note of who else is here: a soft pulsing dot and a count, nothing more. */
export function PresenceNote() {
  const online = usePresence();
  if (online === null || online < 1) return null;
  const others = online - 1;
  return (
    <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums animate-in fade-in duration-300 motion-reduce:animate-none">
      <span aria-hidden className="relative inline-flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/60 motion-reduce:animate-none" />
        <span className="relative inline-flex size-2 rounded-full bg-primary" />
      </span>
      {others === 0 ? "You're the only one here right now" : `${online} people here right now`}
    </p>
  );
}
