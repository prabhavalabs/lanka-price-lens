import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export function Alert({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div role="alert" className={cn("rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900", className)} {...props} />;
}
