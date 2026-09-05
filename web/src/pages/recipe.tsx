import { RiCheckLine, RiFireLine, RiTimeLine } from "@remixicon/react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";

import { ProductImage } from "@/components/product-image";
import { QuantityControl } from "@/components/quantity";
import { ShareButtons } from "@/components/share";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchRecipe } from "@/lib/api";
import { dishCategoryLabel, minutesLabel, rupees, titleCase, unitLabel } from "@/lib/format";
import { useBasket } from "@/store/basket";

/**
 * One dish: what it is, what it needs, and what is still to buy. Ingredients the shopper already has
 * are ticked; the rest show today's cheapest price and can be added to the basket in the amount the
 * shopper wants. Pantry items the price vocabulary does not carry are listed plainly.
 */
export function RecipePage() {
  const { id = "" } = useParams();
  const basket = useBasket();
  const recipe = useQuery({ queryKey: ["recipe", id], queryFn: () => fetchRecipe(id), enabled: Boolean(id) });
  if (recipe.isError) return <p className="py-16 text-center text-destructive">{recipe.error.message}</p>;
  if (recipe.isPending) return <div className="space-y-4"><Skeleton className="h-28 rounded-xl" /><Skeleton className="h-64 rounded-xl" /></div>;
  const dish = recipe.data;
  const have = new Set(basket.lines.map((line) => line.id));
  const inBasket = dish.ingredients.filter((ingredient) => have.has(ingredient.product_id));
  const toBuy = dish.ingredients.filter((ingredient) => !have.has(ingredient.product_id));
  const estimate = toBuy.reduce((sum, ingredient) => sum + (ingredient.price?.cheapest ?? 0), 0);
  const unpriced = toBuy.filter((ingredient) => !ingredient.price).length;
  const names = [dish.names.si, dish.names.ta].filter(Boolean).join(" · ");
  const shareText = `${dish.names.en}: ${dish.summary}`;

  return (
    <div className="space-y-6">
      <nav className="text-sm text-muted-foreground"><Link to="/recipes" className="hover:text-primary">Recipes</Link> › {dishCategoryLabel(dish.category)}</nav>
      <header className="space-y-3">
        <div>
          <h1 className="text-balance font-heading text-3xl font-semibold tracking-tight">{dish.names.en}</h1>
          {names ? <p className="text-muted-foreground">{names}</p> : null}
        </div>
        <p className="max-w-2xl text-pretty text-muted-foreground">{dish.summary}</p>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="secondary">{dishCategoryLabel(dish.category)}</Badge>
          <Badge variant="outline" className="gap-1"><RiTimeLine className="size-3" />{minutesLabel(dish.prep_minutes + dish.cook_minutes)}</Badge>
          <Badge variant="outline">{titleCase(dish.difficulty)}</Badge>
          {dish.spice !== "none" ? <Badge variant="outline" className="gap-1"><RiFireLine className="size-3" />{titleCase(dish.spice)}</Badge> : null}
          {dish.meal_slots.map((slot) => <Badge key={slot} variant="outline">{titleCase(slot)}</Badge>)}
          {dish.diet.map((tag) => <Badge key={tag} variant="outline">{titleCase(tag)}</Badge>)}
        </div>
        <ShareButtons title={dish.names.en} text={shareText} />
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="p-4"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">In your basket</p><p className="mt-1 font-heading text-2xl font-semibold tabular-nums">{inBasket.length} <span className="text-sm font-normal text-muted-foreground">of {dish.ingredients.length}</span></p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">Still to buy</p><p className="mt-1 font-heading text-2xl font-semibold tabular-nums">{toBuy.length}</p><p className="text-xs text-muted-foreground">{dish.other_ingredients.length ? `plus ${dish.other_ingredients.length} pantry items` : "no pantry items listed"}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">Rough extra cost</p><p className="mt-1 font-heading text-2xl font-semibold tabular-nums">{toBuy.length ? rupees(estimate) : rupees(0)}</p><p className="text-xs text-muted-foreground">{toBuy.length ? `one unit of each at today's cheapest seller${unpriced ? `; ${unpriced} without a price yet` : ""}` : "you have everything priced"}</p></CardContent></Card>
      </section>

      {toBuy.length ? (
        <Card>
          <CardContent className="p-0">
            <div className="border-b px-4 py-3"><h2 className="font-heading text-lg font-semibold">Still to buy</h2><p className="text-xs text-muted-foreground">Today's cheapest price per unit; add what you need in the amount you need.</p></div>
            <ul className="divide-y">
              {toBuy.map((ingredient) => (
                <li key={ingredient.product_id} className="flex items-center gap-3 px-4 py-2.5">
                  <ProductImage id={ingredient.product_id} label={ingredient.label ?? ingredient.product_id} size="sm" />
                  <div className="min-w-0 flex-1">
                    <Link to={`/p/${ingredient.product_id}`} className="block truncate text-sm font-medium no-underline hover:text-primary">{ingredient.label ?? titleCase(ingredient.product_id.replace(/^product_/u, ""))}</Link>
                    <p className="text-[11px] text-muted-foreground">{ingredient.price ? `from ${rupees(ingredient.price.cheapest)} ${unitLabel(ingredient.price.unit)} · ${ingredient.price.sellers} sellers` : "no published price yet"}</p>
                  </div>
                  <QuantityControl id={ingredient.product_id} label={ingredient.label ?? ingredient.product_id} unit={ingredient.price?.unit ?? "kg"} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {inBasket.length ? (
        <Card>
          <CardContent className="p-0">
            <div className="border-b px-4 py-3"><h2 className="font-heading text-lg font-semibold">From your basket</h2></div>
            <ul className="divide-y">
              {inBasket.map((ingredient) => (
                <li key={ingredient.product_id} className="flex items-center gap-3 px-4 py-2.5">
                  <ProductImage id={ingredient.product_id} label={ingredient.label ?? ingredient.product_id} size="sm" />
                  <Link to={`/p/${ingredient.product_id}`} className="min-w-0 flex-1 truncate text-sm font-medium no-underline hover:text-primary">{ingredient.label ?? ingredient.product_id}</Link>
                  <RiCheckLine className="size-4 text-primary" />
                  <QuantityControl id={ingredient.product_id} label={ingredient.label ?? ingredient.product_id} unit={ingredient.price?.unit ?? "kg"} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {dish.other_ingredients.length ? (
        <Card>
          <CardContent className="p-4">
            <h2 className="font-heading text-lg font-semibold">Pantry and others</h2>
            <p className="mb-2 text-xs text-muted-foreground">Not priced here yet; most kitchens keep them.</p>
            <div className="flex flex-wrap gap-1.5">{dish.other_ingredients.map((item) => <Badge key={item} variant="outline">{item}</Badge>)}</div>
          </CardContent>
        </Card>
      ) : null}

      {dish.variants.length || dish.pairs.length ? (
        <section className="grid gap-3 sm:grid-cols-2">
          {dish.variants.length ? <Card><CardContent className="p-4"><h2 className="font-heading text-base font-semibold">Variants</h2><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{dish.variants.map((variant) => <li key={variant}>{variant}</li>)}</ul></CardContent></Card> : null}
          {dish.pairs.length ? <Card><CardContent className="p-4"><h2 className="font-heading text-base font-semibold">Goes well with</h2><ul className="mt-2 flex flex-wrap gap-1.5">{dish.pairs.map((pair) => <li key={pair.id}><Link to={`/r/${pair.id}`} className="no-underline"><Badge className="hover:border-primary" variant="outline">{pair.label}</Badge></Link></li>)}</ul></CardContent></Card> : null}
        </section>
      ) : null}
    </div>
  );
}
