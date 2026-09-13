import { useState } from "react";

import { ProductImage } from "@/components/product-image";
import { cn } from "@/lib/utils";

const sizes = {
  xs: "size-6 rounded-md text-[10px]",
  sm: "size-8 rounded-lg text-xs",
  md: "size-11 rounded-xl text-sm",
  lg: "size-16 rounded-2xl text-xl",
} as const;

/**
 * A picture for any ingredient line: the product photo for priced products, a pantry photo
 * served from `data/images/pantry/<slug>.jpg` for pantry entries, and a lettered tile when
 * there is no photo or no registry entry, so rows keep their shape.
 */
export function IngredientImage({ id, label, size = "md", className }: { id: string | null; label: string; size?: keyof typeof sizes; className?: string | undefined }) {
  const [failedId, setFailedId] = useState<string | null>(null);
  if (id?.startsWith("product_")) return <ProductImage id={id} label={label} size={size} className={className} />;
  const slug = id?.startsWith("pantry_") ? id.slice("pantry_".length) : null;
  if (slug && failedId !== id) {
    return <img alt="" className={cn("shrink-0 bg-muted object-cover ring-1 ring-white/10", sizes[size], className)} decoding="async" loading="eager" onError={() => setFailedId(id)} src={`/images/pantry/${slug}.jpg`} />;
  }
  return <span aria-hidden className={cn("grid shrink-0 place-items-center bg-muted font-heading font-semibold text-muted-foreground ring-1 ring-border", sizes[size], className)}>{label.slice(0, 1).toUpperCase()}</span>;
}
