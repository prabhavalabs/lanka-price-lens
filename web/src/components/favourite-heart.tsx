import { RiHeartFill, RiHeartLine } from "@remixicon/react";
import { useLocation, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { locationPath, withReturnTo } from "@/lib/account-forms";
import { cn } from "@/lib/utils";
import { useFavourite, useFavouriteActions } from "@/store/favourites";

/**
 * The heart: a favourite recipe or not. Signed out it opens the sign-in page and comes back
 * here, since favourites live on the account; signed in it flips at once and settles with the
 * server behind the scenes. "overlay" sits on a photograph with a solid, blurred backing.
 */
export function FavouriteHeart({ dishId, label, size = "sm", tone = "default", className }: { dishId: string; label: string; size?: "sm" | "md"; tone?: "default" | "overlay" | undefined; className?: string | undefined }) {
  const { favourite, status } = useFavourite(dishId);
  const actions = useFavouriteActions();
  const navigate = useNavigate();
  const location = useLocation();
  const press = () => {
    if (status === "signed_out") {
      navigate(withReturnTo("/account/login", locationPath(location)));
      return;
    }
    void actions.toggle(dishId);
  };
  const wording = favourite ? `Remove ${label} from your favourites` : `Add ${label} to your favourites`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={wording}
          aria-pressed={favourite}
          className={cn("shrink-0 text-muted-foreground hover:text-rose-500", favourite && "text-rose-500 hover:text-rose-600", tone === "overlay" && "rounded-full border border-border/60 bg-background/85 shadow-md backdrop-blur", className)}
          disabled={status === "loading"}
          onClick={press}
          size={size === "md" ? "icon" : "icon-sm"}
          type="button"
          variant="ghost"
        >
          {favourite ? <RiHeartFill className={size === "md" ? "size-5" : "size-4"} /> : <RiHeartLine className={size === "md" ? "size-5" : "size-4"} />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{favourite ? "A favourite of yours" : "Add to favourites"}</TooltipContent>
    </Tooltip>
  );
}
