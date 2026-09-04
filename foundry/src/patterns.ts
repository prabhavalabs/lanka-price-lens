import type { ItemPattern, MappingBundle } from "@lanka-pricelens/shared";

import { countFromLabel } from "./units.ts";

/**
 * Pattern mapping for whole-catalogue sources. A bundle's items may carry
 * `source_patterns`; a staging row whose label has no exact mapping is tested
 * against them in bundle order and the first match wins. Compiled rules are cached
 * per bundle object so a capture of thousands of rows compiles each regex once.
 */

type CompiledRule = { itemId: string; pattern: ItemPattern; match: RegExp; exclude: RegExp[]; units: Set<string> };
type CompiledBundle = { rules: CompiledRule[]; excluded: RegExp[]; factors: Map<string, { numerator: number; denominator: number }> };

const compiled = new WeakMap<MappingBundle, CompiledBundle>();

export type PatternMatch = {
  itemId: string;
  /** Pack the price applies to after the rule's pack handling; equals the captured pack unless the rule re-read a count. */
  quantity: string;
  unit: string;
  pattern: ItemPattern;
};

export function bundleHasPatterns(bundle: MappingBundle): boolean {
  return bundle.items.some((item) => item.source_patterns.length > 0);
}

export function matchItemPattern(bundle: MappingBundle, label: string, quantity: string, unit: string): PatternMatch | null {
  const rules = compile(bundle);
  if (!rules.rules.length) return null;
  if (rules.excluded.some((pattern) => pattern.test(label))) return null;
  for (const rule of rules.rules) {
    if (!rule.match.test(label) || rule.exclude.some((pattern) => pattern.test(label))) continue;
    let packQuantity = quantity;
    let packUnit = unit;
    if (rule.pattern.pack === "count") {
      const count = countFromLabel(label);
      if (count) {
        packQuantity = String(count);
        packUnit = "piece";
      }
    }
    if (rule.units.size && !rule.units.has(packUnit)) continue;
    if (rule.pattern.min_quantity !== null) {
      const factor = rules.factors.get(packUnit);
      if (!factor) continue;
      const normalized = (Number(packQuantity) * factor.numerator) / factor.denominator;
      if (!Number.isFinite(normalized) || normalized < rule.pattern.min_quantity) continue;
    }
    return { itemId: rule.itemId, quantity: packQuantity, unit: packUnit, pattern: rule.pattern };
  }
  return null;
}

function compile(bundle: MappingBundle): CompiledBundle {
  const cached = compiled.get(bundle);
  if (cached) return cached;
  const regex = (source: string) => new RegExp(source, "iu");
  const result: CompiledBundle = {
    rules: bundle.items.flatMap((item) =>
      item.source_patterns.map((pattern) => ({ itemId: item.id, pattern, match: regex(pattern.match), exclude: pattern.exclude.map(regex), units: new Set(pattern.units) })),
    ),
    excluded: bundle.excluded_patterns.map(regex),
    factors: new Map(bundle.units.map((unit) => [unit.source_unit, { numerator: unit.factor_numerator, denominator: unit.factor_denominator }])),
  };
  compiled.set(bundle, result);
  return result;
}
