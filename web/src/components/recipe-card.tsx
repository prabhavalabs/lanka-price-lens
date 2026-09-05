import { RiTimeLine } from "@remixicon/react";
import { Link } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { Dish } from "@/lib/api";
import { dishCategoryLabel, minutesLabel, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";

/** A dish at a glance: name, category, time, and, when it comes from the basket, how much of it the shopper already has. */
export function RecipeCard({ dish, matched, missing, labels, className }: { dish: Dish; matched?: string[] | undefined; missing?: string[] | undefined; labels?: Record<string, string> | undefined; className?: string | undefined }) {
  const total = dish.key_ingredients.length;
  const have = matched?.length ?? 0;
  const names = [dish.names.si, dish.names.ta_latn && !dish.names.si ? dish.names.ta_latn : null].filter(Boolean).join(" · ");
  return (
    <Link to={`/r/${dish.id}`} className={cn("block no-underline", className)}>
      <Card className="h-full transition-colors hover:border-primary/50">
        <CardContent className="flex h-full flex-col gap-2 p-4">
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
      </Card>
    </Link>
  );
}
