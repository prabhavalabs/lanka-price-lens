/**
 * Small, dependency-free fuzzy matcher tuned for short product names.
 *
 * Every query token must match some word of the candidate. A token matches by
 * exact word, word prefix, substring, in-order subsequence, or a small typo
 * (Damerau-Levenshtein distance of one, or two for longer tokens). Scores are
 * comparable across candidates so results can be ranked.
 */
export type FuzzyResult<T> = { item: T; score: number };

export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

export function fuzzyScore(query: string, candidate: string): number {
  const tokens = normalize(query).split(" ").filter(Boolean);
  if (!tokens.length) return 0;
  const text = normalize(candidate);
  if (!text) return 0;
  const words = text.split(" ");
  let total = 0;
  for (const token of tokens) {
    let best = 0;
    if (text === token) best = 120;
    else if (text.startsWith(token)) best = 100;
    for (const word of words) {
      best = Math.max(best, wordScore(token, word));
      if (best >= 100) break;
    }
    if (best === 0) return 0;
    total += best;
  }
  // Prefer shorter candidates when the token evidence is equal.
  return total / tokens.length - Math.min(text.length, 40) / 10;
}

function wordScore(token: string, word: string): number {
  if (word === token) return 100;
  if (word.startsWith(token)) return 80 + (token.length / word.length) * 15;
  if (word.includes(token)) return 60 + (token.length / word.length) * 10;
  const subsequence = subsequenceScore(token, word);
  const typos = token.length >= 4 ? damerauLevenshtein(token, word.slice(0, Math.max(token.length + 1, 1))) : Number.POSITIVE_INFINITY;
  const allowed = token.length >= 7 ? 2 : 1;
  const typoScore = typos <= allowed ? 55 - typos * 10 : 0;
  return Math.max(subsequence, typoScore);
}

function subsequenceScore(token: string, word: string): number {
  if (token.length < 2) return 0;
  let position = 0;
  let gaps = 0;
  for (const character of token) {
    const found = word.indexOf(character, position);
    if (found < 0) return 0;
    gaps += found - position;
    position = found + 1;
  }
  return Math.max(0, 45 - gaps * 4);
}

export function damerauLevenshtein(left: string, right: string): number {
  const rows = left.length + 1;
  const columns = right.length + 1;
  const distance: number[][] = Array.from({ length: rows }, () => new Array<number>(columns).fill(0));
  for (let row = 0; row < rows; row += 1) distance[row]![0] = row;
  for (let column = 0; column < columns; column += 1) distance[0]![column] = column;
  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      let value = Math.min(distance[row - 1]![column]! + 1, distance[row]![column - 1]! + 1, distance[row - 1]![column - 1]! + cost);
      if (row > 1 && column > 1 && left[row - 1] === right[column - 2] && left[row - 2] === right[column - 1]) {
        value = Math.min(value, distance[row - 2]![column - 2]! + 1);
      }
      distance[row]![column] = value;
    }
  }
  return distance[rows - 1]![columns - 1]!;
}

/** Rank `items` by the best score across every text `fields` returns for them. */
export function fuzzySearch<T>(query: string, items: readonly T[], fields: (item: T) => readonly string[], limit = 12): FuzzyResult<T>[] {
  if (!normalize(query)) return [];
  const results: FuzzyResult<T>[] = [];
  for (const item of items) {
    let score = 0;
    for (const field of fields(item)) score = Math.max(score, fuzzyScore(query, field));
    if (score > 0) results.push({ item, score });
  }
  return results.sort((left, right) => right.score - left.score).slice(0, limit);
}
