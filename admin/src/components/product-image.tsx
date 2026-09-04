import { useState } from "react";

import { cn } from "@/lib/utils";

const sizes = {
  xs: "size-6 rounded-md text-[10px]",
  sm: "size-8 rounded-lg text-xs",
  md: "size-12 rounded-xl text-base",
  lg: "size-16 rounded-2xl text-xl",
  xl: "size-24 rounded-2xl text-2xl",
} as const;

/**
 * Product photo served from `admin/public/products/<slug>.jpg`. Falls back to a
 * lettered tile when a product has no photo yet, so the layout never breaks.
 */
export function ProductImage({ id, label, size = "md", className }: { id: string; label: string; size?: keyof typeof sizes; className?: string | undefined }) {
  // Remembered per product id: when the same element switches from a product without a photo to one with a photo, the photo must load again.
  const [failedId, setFailedId] = useState<string | null>(null);
  const failed = failedId === id;
  const slug = id.replace(/^product_/u, "");
  if (failed) {
    return <span aria-hidden className={cn("grid shrink-0 place-items-center bg-primary/10 font-heading font-semibold text-primary ring-1 ring-primary/20", sizes[size], className)}>{label.slice(0, 1).toUpperCase()}</span>;
  }
  return <img alt="" className={cn("shrink-0 bg-muted object-cover ring-1 ring-white/10", sizes[size], className)} decoding="async" loading="eager" onError={() => setFailedId(id)} src={`/admin/products/${slug}.jpg`} />;
}
