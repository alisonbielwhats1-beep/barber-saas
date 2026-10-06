/** Iterative Kahn + weak components: no recursion or action-count capacity limit. */
export function dependencyGraph(actions: readonly { key: string; depends_on: readonly string[] }[]) {
  const byKey = new Map(actions.map(action => [action.key, action]));
  const invalid = () => { throw new Error("INVALID_DEPENDENCY_GRAPH"); };
  if (byKey.size !== actions.length) invalid();
  const children = new Map(actions.map(action => [action.key, [] as string[]]));
  const remaining = new Map<string, number>();
  for (const action of actions) {
    if (new Set(action.depends_on).size !== action.depends_on.length) invalid();
    remaining.set(action.key, action.depends_on.length);
    for (const parent of action.depends_on) {
      if (!byKey.has(parent) || parent === action.key) invalid();
      children.get(parent)!.push(action.key);
    }
  }
  const order = actions.filter(action => !action.depends_on.length).map(action => action.key);
  for (let cursor = 0; cursor < order.length; cursor++) {
    for (const child of children.get(order[cursor])!) {
      const count = remaining.get(child)! - 1;
      remaining.set(child, count);
      if (count === 0) order.push(child);
    }
  }
  if (order.length !== actions.length) invalid();
  const rank = new Map(order.map((key, index) => [key, index]));
  const visited = new Set<string>(), components: string[][] = [];
  for (const key of order) {
    if (visited.has(key)) continue;
    const queue = [key]; visited.add(key);
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const current = queue[cursor];
      for (const neighbour of [...byKey.get(current)!.depends_on, ...children.get(current)!]) {
        if (!visited.has(neighbour)) { visited.add(neighbour); queue.push(neighbour); }
      }
    }
    components.push(queue.sort((a, b) => rank.get(a)! - rank.get(b)!));
  }
  return { order, components, children };
}
