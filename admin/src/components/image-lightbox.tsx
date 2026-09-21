import { useState, type ReactNode } from "react";
import { RiZoomInLine } from "@remixicon/react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

/**
 * A picture opened at its own size. The cards are drawn at 1080 wide and read on a phone, so the
 * thumbnail in a page never shows what a reader will actually meet; this puts the whole thing on
 * the screen, and nothing else.
 */
export function ImageLightbox({ alt, caption, children, className, src }: { alt: string; caption?: ReactNode; children?: ReactNode; className?: string; src: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        aria-label={`${alt} — open it at full size`}
        className={`group relative block cursor-zoom-in overflow-hidden rounded-lg border ${className ?? ""}`}
        onClick={() => setOpen(true)}
        type="button"
      >
        {children ?? <img alt={alt} className="w-full" loading="lazy" src={src} />}
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <span className="flex items-center gap-1.5 rounded-full bg-background/90 px-3 py-1.5 text-xs font-medium"><RiZoomInLine className="size-4" />Full size</span>
        </span>
      </button>
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent className="max-h-[94vh] w-auto max-w-[min(96vw,1100px)] overflow-auto p-3 sm:max-w-[min(96vw,1100px)]">
          <DialogTitle className="sr-only">{alt}</DialogTitle>
          <DialogDescription className="sr-only">The picture at its own size.</DialogDescription>
          <img alt={alt} className="mx-auto h-auto w-full max-w-full rounded" src={src} />
          {caption ? <p className="pt-2 text-center text-xs text-muted-foreground">{caption}</p> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
