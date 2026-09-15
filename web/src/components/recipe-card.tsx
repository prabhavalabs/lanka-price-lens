import { RiArrowRightUpLine, RiTimeLine } from "@remixicon/react";
import type React from "react";
import { Link } from "react-router-dom";

import { DishPhoto } from "@/components/dish-photo";
import { RecipeReactions } from "@/components/reactions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { Dish } from "@/lib/api";
import { dishCategoryLabel, minutesLabel, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * A dish at a glance: the photograph on top with "Open recipe" in its top corner and the thumbs
 * in its bottom corner, then the name, the summary, and the facts, all linking to the recipe.
 * From the basket the card shows instead how much of the dish the shopper already has.
 */
export function RecipeCard({ dish, score, matched, missing, labels, className, children }: { dish: Dish; /** Likes less dislikes from signed-in readers; with it the card gets its thumbs footer. */ score?: number | undefined; matched?: string[] | undefined; missing?: string[] | undefined; labels?: Record<string, string> | undefined; className?: string | undefined; children?: React.ReactNode }) {
  const total = dish.key_ingredients.length;
  const have = matched?.length ?? 0;
  const names = [dish.names.si, dish.names.ta_latn && !dish.names.si ? dish.names.ta_latn : null].filter(Boolean).join(" · ");
  return (
    <Card className={cn("relative flex h-full flex-col gap-0 overflow-hidden py-0 transition-colors hover:border-primary/50", className)}>
      <div className="relative">
        <Link to={`/r/${dish.id}`} className="block no-underline"><DishPhoto className="aspect-[3/2] w-full" dishId={dish.id} placeholder /></Link>
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-card via-card/60 to-transparent" />
        <Link className="absolute right-3 top-3 inline-flex h-7 items-center gap-1 rounded-full border border-border/60 bg-background/85 pl-2.5 pr-2 text-xs font-medium text-foreground no-underline shadow-md backdrop-blur transition-colors hover:border-primary hover:text-primary" to={`/r/${dish.id}`}>Open recipe<RiArrowRightUpLine aria-hidden className="size-3.5" /></Link>
        {score !== undefined ? <RecipeReactions className="absolute bottom-3 right-3" dishId={dish.id} score={score} tone="overlay" /> : null}
      </div>
      <Link to={`/r/${dish.id}`} className="flex flex-1 flex-col no-underline">
        <CardContent className="flex flex-1 flex-col gap-2 px-4 pb-4 pt-1">
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
    </Card>
  );
}
