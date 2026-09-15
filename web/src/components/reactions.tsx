import { RiThumbDownFill, RiThumbDownLine, RiThumbUpFill, RiThumbUpLine } from "@remixicon/react";
import { useLocation, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { OwnReaction } from "@/lib/account-api";
import { locationPath, withReturnTo } from "@/lib/account-forms";
import { describeContributionError, nextReaction } from "@/lib/contributions";
import { cn } from "@/lib/utils";
import { useReact, useReaction } from "@/store/community";

/**
 * Thumbs up and down with the dish's score between them. The pressed thumb is filled; pressing
 * it again takes the reaction back. Signed out, a press opens the sign-in page and comes back
 * here, since a reaction lives on the account. Signed in, the score moves at once and settles
 * with the server behind the scenes.
 */
export function RecipeReactions({ dishId, score, className, tone = "default" }: { dishId: string; /** Likes less dislikes, never below zero. */ score: number; className?: string | undefined; /** "overlay" sits on a photograph: a solid, blurred backing and no error line. */ tone?: "default" | "overlay" | undefined }) {
  const { value, status } = useReaction(dishId);
  const actions = useReact();
  const navigate = useNavigate();
  const location = useLocation();
  const press = (thumb: OwnReaction) => {
    if (status === "signed_out") {
      navigate(withReturnTo("/account/login", locationPath(location)));
      return;
    }
    if (status === "loading") return;
    actions.clearError();
    void actions.react(dishId, nextReaction(value, thumb));
  };
  const up = value === "up";
  const down = value === "down";
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <div aria-label="Did this recipe work for you?" className={cn("inline-flex h-8 items-center overflow-hidden rounded-lg border border-border", tone === "overlay" ? "border-border/60 bg-background/85 shadow-md backdrop-blur" : "bg-input/20 dark:bg-input/30")} role="group">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={up ? "Take back your thumbs up" : "Thumbs up"}
              aria-pressed={up}
              className={cn("h-full rounded-none px-2.5 text-muted-foreground hover:text-primary", up && "text-primary hover:text-primary")}
              disabled={status === "loading"}
              onClick={() => press("up")}
              size="sm"
              type="button"
              variant="ghost"
            >
              {up ? <RiThumbUpFill className="size-4" /> : <RiThumbUpLine className="size-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{up ? "You liked this" : "Worked for me"}</TooltipContent>
        </Tooltip>
        <span aria-label={`Score ${score}`} aria-live="polite" className="min-w-7 border-x border-border px-1.5 text-center text-sm font-semibold tabular-nums">{score}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={down ? "Take back your thumbs down" : "Thumbs down"}
              aria-pressed={down}
              className={cn("h-full rounded-none px-2.5 text-muted-foreground hover:text-foreground", down && "text-foreground")}
              disabled={status === "loading"}
              onClick={() => press("down")}
              size="sm"
              type="button"
              variant="ghost"
            >
              {down ? <RiThumbDownFill className="size-4" /> : <RiThumbDownLine className="size-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{down ? "You marked this down" : "Not for me"}</TooltipContent>
        </Tooltip>
      </div>
      {actions.error && tone !== "overlay" ? <span className="text-xs text-destructive" role="alert">{describeContributionError(actions.error)}</span> : null}
    </div>
  );
}
