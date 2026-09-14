import { RiThumbUpLine, RiTimeLine } from "@remixicon/react";
import type React from "react";
import { Link } from "react-router-dom";

import { RecipeReactions } from "@/components/reactions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { Dish } from "@/lib/api";
import { dishCategoryLabel, minutesLabel, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * A dish at a glance, laid out like a social card: the name and summary link to the recipe,
 * the readers' score sits in the top corner when it is above zero, and a footer carries the
 * thumbs so a reader can react from the list. From the basket the card shows instead how much
 * of the dish the shopper already has.
 */
export function RecipeCard({ dish, score, matched, missing, labels, className, children }: { dish: Dish; /** Likes less dislikes from signed-in readers; with it the card gets its thumbs footer. */ score?: number | undefined; matched?: string[] | undefined; missing?: string[] | undefined; labels?: Record<string, string> | undefined; className?: string | undefined; children?: React.ReactNode }) {
  const total = dish.key_ingredients.length;
  const have = matched?.length ?? 0;
  const names = [dish.names.si, dish.names.ta_latn && !dish.names.si ? dish.names.ta_latn : null].filter(Boolean).join(" · ");
  return (
    <Card className={cn("relative flex h-full flex-col transition-colors hover:border-primary/50", className)}>
      {score ? <Badge aria-label={`${score} more thumbs up than down`} className="absolute right-3 top-3 gap-1 border-primary/40 bg-primary/10 text-[10px] text-primary tabular-nums" title="Thumbs up from readers, less thumbs down" variant="outline"><RiThumbUpLine aria-hidden className="size-3" />{score}</Badge> : null}
      <Link to={`/r/${dish.id}`} className="block flex-1 no-underline">
        <CardContent className={cn("flex h-full flex-col gap-2 p-4", score ? "pr-14" : "")}>
          <div>
            <h3 className="font-heading text-base font-semibold leading-tight">{dish.names.en}</h3>
            {names ? <p className="truncate text-xs text-muted-foreground">{names}</p> : null}
          </div>
          <p className="line-clamp-2 text-pretty text-xs text-muted-foreground">{dish.summary}</p>
          <div className="mt-auto flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="text-[10px]">{dishCategoryLabel(dish.category)}</Badge>
            <Badge variant="outline" className="gap-1 text-[10px]"><RiTimeLine className="size-3" />{minutesLabel(dish.prep_minutes + dish.cook_minutes)}</Badge>
            <Badge variant="outline" className="text-[10px]">{titleCase(dish.difficulty)}</Badge>
          </div>
          {children}
          {matched ? (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs">
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary transition-all" style={{ width: `${total ? Math.round((have / total) * 100) : 0}%` }} /></span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{have} of {total} in basket</span>
              </div>
              {missing?.length ? <p className="truncate text-[11px] text-muted-foreground">Needs {missing.map((id) => labels?.[id] ?? titleCase(id.replace(/^product_/u, ""))).join(", ")}</p> : <p className="text-[11px] font-medium text-primary">You have every key ingredient</p>}
            </div>
          ) : null}
        </CardContent>
      </Link>
      {score !== undefined ? (
        <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
          <RecipeReactions dishId={dish.id} score={score} />
          <Link className="text-xs text-muted-foreground no-underline hover:text-primary" to={`/r/${dish.id}`}>Open recipe</Link>
        </div>
      ) : null}
    </Card>
  );
}
