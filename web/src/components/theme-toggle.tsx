import { RiComputerLine, RiMoonLine, RiSunLine } from "@remixicon/react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useTheme, type ThemeChoice } from "@/store/theme";

export function ThemeToggle() {
  const theme = useTheme();
  const Icon = theme.choice === "system" ? RiComputerLine : theme.resolved === "dark" ? RiMoonLine : RiSunLine;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label={`Theme: ${theme.choice}`} size="icon-sm" variant="ghost"><Icon className="size-4" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuRadioGroup onValueChange={(value) => theme.set(value as ThemeChoice)} value={theme.choice}>
          <DropdownMenuRadioItem value="light"><RiSunLine className="size-4" />Light</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark"><RiMoonLine className="size-4" />Dark</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system"><RiComputerLine className="size-4" />Device setting</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
