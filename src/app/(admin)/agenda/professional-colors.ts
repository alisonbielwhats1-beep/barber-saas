const PALETTE = ["#4B91D1", "#A07ACA", "#35A58C", "#D38D50", "#D272A1", "#91A94E", "#6B9FA8", "#C9A74F"];

/** Resolve the entire roster before filtering so colors do not jump between views. */
export function professionalColors(professionals: { id: string; colorHex: string | null }[]) {
  const result = new Map<string, string>();
  const used = new Set<string>();
  const sorted = [...professionals].sort((a, b) => a.id.localeCompare(b.id));
  for (const pro of sorted) {
    const color = pro.colorHex?.toUpperCase();
    if (color && /^#[0-9A-F]{6}$/.test(color) && !used.has(color)) {
      result.set(pro.id, color);
      used.add(color);
    }
  }
  let next = 0;
  for (const pro of sorted) {
    if (result.has(pro.id)) continue;
    let color: string;
    do {
      color = PALETTE[next] ?? `hsl(${((next * 137.508) % 360).toFixed(2)} 48% 56%)`;
      next++;
    } while (used.has(color));
    result.set(pro.id, color);
    used.add(color);
  }
  return result;
}
