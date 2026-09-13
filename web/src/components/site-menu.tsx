import { RiBookOpenLine, RiComputerLine, RiDiscordFill, RiFeedbackLine, RiInformationLine, RiMoonLine, RiMore2Line, RiSunLine } from "@remixicon/react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { FeedbackDialog } from "@/components/feedback-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { trackEvent } from "@/lib/analytics";
import { useTheme, type ThemeChoice } from "@/store/theme";

/**
 * The header's overflow menu: everything a visitor reaches now and then (the guide, about,
 * feedback, the community, the theme) behind one button, so the bar keeps only what they use on
 * every visit: search, recipes, menus, basket, account.
 */
export function SiteMenu({ discordInviteUrl }: { discordInviteUrl: string | null }) {
  const theme = useTheme();
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button aria-label="More" size="icon-sm" variant="ghost"><RiMore2Line className="size-4" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuItem asChild><Link className="no-underline" to="/guide"><RiBookOpenLine />How to use the site</Link></DropdownMenuItem>
          <DropdownMenuItem asChild><Link className="no-underline" to="/about"><RiInformationLine />About and sources</Link></DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setFeedbackOpen(true)}><RiFeedbackLine />Send feedback</DropdownMenuItem>
          {discordInviteUrl ? (
            <DropdownMenuItem asChild>
              <a className="no-underline" href={discordInviteUrl} onClick={() => trackEvent("community_invite", { action: "menu" })} rel="noopener noreferrer" target="_blank"><RiDiscordFill />Discord community</a>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup onValueChange={(value) => theme.set(value as ThemeChoice)} value={theme.choice}>
            <DropdownMenuRadioItem value="light"><RiSunLine className="size-4" />Light</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark"><RiMoonLine className="size-4" />Dark</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system"><RiComputerLine className="size-4" />Device setting</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <FeedbackDialog onOpenChange={setFeedbackOpen} open={feedbackOpen} trigger={null} />
    </>
  );
}
