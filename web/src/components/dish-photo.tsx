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

export function DishPhoto({ dishId, alt = "", className, loading = "lazy" }: { dishId: string; alt?: string | undefined; className?: string | undefined; loading?: "lazy" | "eager" | undefined }) {
  const [failedId, setFailedId] = useState<string | null>(null);
  if (failedId === dishId) return null;
  return <img alt={alt} className={cn("block w-full bg-muted object-cover", className)} decoding="async" loading={loading} onError={() => setFailedId(dishId)} src={dishPhotoUrl(dishId)} />;
}
