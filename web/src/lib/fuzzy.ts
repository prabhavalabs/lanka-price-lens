/**
 * Forgiving product search for a shopper typing on a phone: "potatos", "b onion", "dhal" and
 * "parippu" should all land. Scores a query against a product's names and aliases by exact,
 * prefix, word-prefix, and substring matches, then by a small edit distance on each word, so a
 * missing or swapped letter still finds the product while unrelated products stay out.
 */

export type Searchable = { id: string; label: string; terms: string[] };

export type Match<T extends Searchable> = { item: T; score: number; matched: string };

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/gu, "")
    .replace(/['’`]/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Damerau–Levenshtein distance with a cap: stops counting once the cap is passed. */
export function editDistance(left: string, right: string, cap = 2): number {
  if (left === right) return 0;
  if (Math.abs(left.length - right.length) > cap) return cap + 1;
  const rows = left.length + 1;
  const columns = right.length + 1;
  const table: number[][] = Array.from({ length: rows }, (_, row) => Array.from({ length: columns }, (_, column) => (row === 0 ? column : column === 0 ? row : 0)));
  for (let row = 1; row < rows; row += 1) {
    let best = Number.POSITIVE_INFINITY;
    for (let column = 1; column < columns; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      let value = Math.min(table[row - 1]![column]! + 1, table[row]![column - 1]! + 1, table[row - 1]![column - 1]! + cost);
      if (row > 1 && column > 1 && left[row - 1] === right[column - 2] && left[row - 2] === right[column - 1]) value = Math.min(value, table[row - 2]![column - 2]! + 1);
      table[row]![column] = value;
      best = Math.min(best, value);
    }
    if (best > cap) return cap + 1;
  }
  return table[rows - 1]![columns - 1]!;
}

function scoreTerm(query: string, term: string): number {
  if (!term) return 0;
  if (term === query) return 100;
  if (term.startsWith(query)) return 90 - Math.min(20, term.length - query.length);
  const words = term.split(" ");
  if (words.some((word) => word.startsWith(query))) return 80;
  if (term.includes(query)) return 70;
  // Every query word must be found somewhere in the term, exactly or within a small edit distance.
  const queryWords = query.split(" ").filter(Boolean);
  let total = 0;
  for (const queryWord of queryWords) {
    let best = 0;
    for (const word of words) {
      if (word.startsWith(queryWord)) best = Math.max(best, 60);
      else if (queryWord.length >= 4 && word.length >= 4) {
        const distance = editDistance(queryWord, word, queryWord.length >= 6 ? 2 : 1);
        if (distance <= (queryWord.length >= 6 ? 2 : 1)) best = Math.max(best, 55 - distance * 10);
      }
    }
    if (!best) return 0;
    total += best;
  }
  return total / queryWords.length;
}

export function fuzzySearch<T extends Searchable>(items: T[], rawQuery: string, limit = 8): Match<T>[] {
  const query = normalize(rawQuery);
  if (!query) return [];
  const matches: Match<T>[] = [];
  for (const item of items) {
    let score = 0;
    let matched = item.label;
    for (const term of [item.label, ...item.terms]) {
      const normalized = normalize(term);
      // Names count fully; aliases a little less, so "Potato" outranks a product that merely lists "potato" among its store names.
      const value = scoreTerm(query, normalized) * (term === item.label ? 1 : 0.95);
      if (value > score) {
        score = value;
        matched = term;
      }
    }
    if (score > 0) matches.push({ item, score, matched });
  }
  return matches.sort((left, right) => right.score - left.score || left.item.label.localeCompare(right.item.label)).slice(0, limit);
}
