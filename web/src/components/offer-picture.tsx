import { useState } from "react";

import { SellerMark } from "@/components/seller-mark";
import type { Offer } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The picture beside an offer. A store's own picture is a pack shot on white, so it sits whole on a
 * white tile in both themes; the site's generated photo of the product fills the tile; with neither,
 * or when the file fails to load, the store's mark stands in so the row never shows a broken image.
 */
export function OfferPicture({ offer, className }: { offer: Pick<Offer, "image" | "image_origin" | "market" | "market_id" | "label">; className?: string | undefined }) {
  const [failed, setFailed] = useState<string | null>(null);
  const picture = offer.image && failed !== offer.image ? offer.image : null;
  return (
    <div className={cn("grid shrink-0 place-items-center overflow-hidden rounded-lg border border-border/60", picture && offer.image_origin === "store" ? "bg-white" : "bg-muted/40", className)}>
      {picture ? (
        <img alt="" className={cn("size-full", offer.image_origin === "store" ? "object-contain p-1" : "object-cover")} decoding="async" loading="lazy" onError={() => setFailed(picture)} src={picture} />
      ) : offer.market_id ? (
        <SellerMark label={offer.market} marketId={offer.market_id} size="sm" type="online_store" />
      ) : null}
    </div>
  );
}
