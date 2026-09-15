import { useState } from "react";

import { cn } from "@/lib/utils";

/**
 * A dish's photograph, served from `data/images/recipes/<slug>.jpg` (made by
 * scripts/recipes/photos.mjs). Nothing is rendered when the site has no picture for the dish,
 * so a card or a page keeps its shape either way.
 */
export function dishPhotoUrl(dishId: string): string {
  return `/images/recipes/${dishId.replace(/^dish_/u, "")}.jpg`;
}

export function DishPhoto({ dishId, alt = "", className, loading = "lazy", placeholder = false }: { dishId: string; alt?: string | undefined; className?: string | undefined; loading?: "lazy" | "eager" | undefined; /** With it, a dish without a picture keeps the space as a plain tile instead of rendering nothing. */ placeholder?: boolean | undefined }) {
  const [failedId, setFailedId] = useState<string | null>(null);
  if (failedId === dishId) return placeholder ? <div aria-hidden className={cn("block w-full bg-gradient-to-br from-muted to-muted/40", className)} /> : null;
  return <img alt={alt} className={cn("block w-full bg-muted object-cover", className)} decoding="async" loading={loading} onError={() => setFailedId(dishId)} src={dishPhotoUrl(dishId)} />;
}
