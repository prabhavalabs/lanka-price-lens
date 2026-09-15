import { RiStarFill, RiStarLine } from "@remixicon/react";
import { useLocation, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { locationPath, withReturnTo } from "@/lib/account-forms";
import { cn } from "@/lib/utils";
import { useWatchActions, useWatched } from "@/store/watchlist";

/**
 * The star: on the wishlist or not. Signed out it opens the sign-in page and comes back here,
 * since the wishlist lives on the account; signed in it flips at once and settles with the
 * server behind the scenes.
 */
export function WatchStar({ productId, label, size = "sm", className }: { productId: string; label: string; size?: "sm" | "md"; className?: string | undefined }) {
  const { watched, status } = useWatched(productId);
  const actions = useWatchActions();
  const navigate = useNavigate();
  const location = useLocation();
  const press = () => {
    if (status === "signed_out") {
      navigate(withReturnTo("/account/login", locationPath(location)));
      return;
    }
    void actions.toggle(productId);
  };
  const wording = watched ? `Remove ${label} from your wishlist` : `Add ${label} to your wishlist`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={wording}
          aria-pressed={watched}
          className={cn("shrink-0 text-muted-foreground hover:text-amber-500", watched && "text-amber-500 hover:text-amber-600", className)}
          disabled={status === "loading"}
          onClick={press}
          size={size === "md" ? "icon" : "icon-sm"}
          type="button"
          variant="ghost"
        >
          {watched ? <RiStarFill className={size === "md" ? "size-5" : "size-4"} /> : <RiStarLine className={size === "md" ? "size-5" : "size-4"} />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{watched ? "On your wishlist" : "Add to wishlist"}</TooltipContent>
    </Tooltip>
  );
}
