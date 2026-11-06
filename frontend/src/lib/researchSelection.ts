export const MAX_RESEARCH_BATCH = 1000;

/** Preserve the displayed order, normalize class shares for the data provider. */
export function parseTickers(raw: string): string[] {
  return [...new Set(raw.toUpperCase().split(/[\s,，;；]+/).map(t => t.trim().replace(/[./]([AB])$/, "-$1")).filter(Boolean))];
}

export function addTickers(current: string[], additions: string[]): string[] {
  return parseTickers([...current, ...additions].join(","));
}

export function removeTickers(current: string[], removals: string[]): string[] {
  const excluded = new Set(parseTickers(removals.join(",")));
  return current.filter(t => !excluded.has(t));
}

export function selectionCoverage(members: string[], selected: string[]): "none" | "partial" | "all" {
  const chosen = new Set(selected);
  const count = members.filter(t => chosen.has(t)).length;
  return count === 0 ? "none" : count === members.length ? "all" : "partial";
}
