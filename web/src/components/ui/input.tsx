import * as React from "react"

import { controlHeight, type ControlSize } from "@/components/ui/control-size"
import { cn } from "@/lib/utils"

/** `size` is the control scale, not the input's character width; the native attribute is not used here. */
function Input({ className, size = "default", type, ...props }: Omit<React.ComponentProps<"input">, "size"> & { size?: ControlSize }) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        `${controlHeight[size]} w-full min-w-0 rounded-lg border border-input bg-white/[0.025] px-3 py-1 text-sm transition-colors outline-none file:mr-3 file:inline-flex file:h-8 file:border-0 file:border-r file:border-white/10 file:bg-white/5 file:px-3 file:text-xs file:font-medium file:text-foreground placeholder:text-muted-foreground hover:border-white/20 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40`,
        className
      )}
      {...props}
    />
  )
}

export { Input }
