import { RiCheckLine, RiShareForwardLine, RiWhatsappLine } from "@remixicon/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

/** Share a page: the device's share sheet when it has one, WhatsApp otherwise, and always a copy-link fallback. */
export function ShareButtons({ title, text }: { title: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window === "undefined" ? "" : window.location.href;
  const share = async () => {
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch {
        // Cancelled or unsupported: fall through to copying.
      }
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.open(`https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`, "_blank", "noopener");
    }
  };
  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={share} size="sm" variant="outline">{copied ? <RiCheckLine className="size-4" /> : <RiShareForwardLine className="size-4" />}{copied ? "Copied" : "Share"}</Button>
      <Button asChild size="sm" variant="outline">
        <a href={`https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`} rel="noreferrer" target="_blank"><RiWhatsappLine className="size-4" />WhatsApp</a>
      </Button>
    </div>
  );
}
