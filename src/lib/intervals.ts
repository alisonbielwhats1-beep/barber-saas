/** Half-open intervals. Union prevents overlapping shifts/absences counting twice. */
export type Interval = { start: number; end: number };

export function unionIntervals(intervals: Interval[]): Interval[] {
  const result: Interval[] = [];
  for (const interval of intervals.filter(i => i.end > i.start).sort((a, b) => a.start - b.start)) {
    const previous = result[result.length - 1];
    if (previous && interval.start <= previous.end) previous.end = Math.max(previous.end, interval.end);
    else result.push({ ...interval });
  }
  return result;
}

export function subtractIntervals(base: Interval[], excluded: Interval[]): Interval[] {
  let result = unionIntervals(base);
  for (const cut of unionIntervals(excluded)) {
    result = result.flatMap(i => cut.end <= i.start || cut.start >= i.end ? [i] : [
      { start: i.start, end: Math.min(i.end, cut.start) },
      { start: Math.max(i.start, cut.end), end: i.end },
    ].filter(part => part.end > part.start));
  }
  return result;
}

export function intervalMinutes(intervals: Interval[]): number {
  return unionIntervals(intervals).reduce((sum, i) => sum + (i.end - i.start) / 60000, 0);
}
