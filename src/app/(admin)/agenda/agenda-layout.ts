export type AgendaInterval = {
  id: string;
  start: number;
  end: number;
};

export type AgendaPlacement = {
  column: number;
  columns: number;
  leftPct: number;
  widthPct: number;
  conflict: boolean;
};

/**
 * Divide intervalos que realmente se sobrepõem em colunas visuais.
 *
 * A regra de negócio continua bloqueando conflito comum no servidor. Esta
 * função é uma defesa de apresentação para overbooking deliberado, importação
 * antiga ou qualquer dado inconsistente que ainda precise ser investigado sem
 * esconder um atendimento atrás de outro.
 */
export function layoutOverlappingIntervals(
  intervals: readonly AgendaInterval[],
): Map<string, AgendaPlacement> {
  const placements = new Map<string, AgendaPlacement>();
  const valid = intervals
    .filter((interval) => interval.end > interval.start)
    .sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));

  const flushCluster = (cluster: AgendaInterval[]) => {
    if (cluster.length === 0) return;

    const columns: number[] = [];
    const assigned: Array<{ interval: AgendaInterval; column: number }> = [];

    for (const interval of cluster) {
      let column = columns.findIndex((columnEnd) => columnEnd <= interval.start);
      if (column === -1) {
        column = columns.length;
        columns.push(interval.end);
      } else {
        columns[column] = interval.end;
      }
      assigned.push({ interval, column });
    }

    const totalColumns = columns.length;
    for (const { interval, column } of assigned) {
      placements.set(interval.id, {
        column,
        columns: totalColumns,
        leftPct: (column / totalColumns) * 100,
        widthPct: 100 / totalColumns,
        conflict: totalColumns > 1,
      });
    }
  };

  let cluster: AgendaInterval[] = [];
  let clusterEnd = -Infinity;
  for (const interval of valid) {
    if (cluster.length > 0 && interval.start >= clusterEnd) {
      flushCluster(cluster);
      cluster = [];
      clusterEnd = -Infinity;
    }
    cluster.push(interval);
    clusterEnd = Math.max(clusterEnd, interval.end);
  }
  flushCluster(cluster);

  for (const interval of intervals) {
    if (placements.has(interval.id)) continue;
    placements.set(interval.id, {
      column: 0,
      columns: 1,
      leftPct: 0,
      widthPct: 100,
      conflict: false,
    });
  }

  return placements;
}
