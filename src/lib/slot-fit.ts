/** Prefer edges of a free interval, which leave one usable gap instead of two. */
export function bestFitSlots(slots: string[], limit = 3): string[] {
  const minute = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  const sorted = [...new Set(slots)].sort();
  const runs: string[][] = [];
  for (const slot of sorted) {
    const run = runs[runs.length - 1];
    if (!run || minute(slot) - minute(run[run.length - 1]!) !== 15) runs.push([slot]);
    else run.push(slot);
  }
  return runs.sort((a, b) => a.length - b.length || a[0]!.localeCompare(b[0]!)).map(run => run[0]!).slice(0, limit);
}
