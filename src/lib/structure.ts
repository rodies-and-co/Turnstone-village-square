// The structure chart: who owns which entity, laid out in rows, owners
// above what they own. Pure functions, no database access.

export type ChartNode = { key: string; label: string; sub: string; kind: "person" | "organisation" | "entity"; href?: string };
export type ChartEdge = { from: string; to: string; label: string; dashed?: boolean };
export type PlacedNode = ChartNode & { x: number; y: number; row: number };
export type PlacedEdge = ChartEdge & { x1: number; y1: number; x2: number; y2: number };

export const BOX_W = 210;
export const BOX_H = 58;
const GAP_X = 36;
const GAP_Y = 96;

// Only what is connected to `focus` (its owners going up, and what it owns
// going down), or everything when there is no focus.
export function connected(nodes: ChartNode[], edges: ChartEdge[], focus?: string) {
  if (!focus) return { nodes, edges };
  const keep = new Set([focus]);
  const walk = (dir: "up" | "down") => {
    const queue = [focus];
    while (queue.length) {
      const k = queue.shift()!;
      for (const e of edges) {
        const next = dir === "up" ? (e.to === k ? e.from : null) : e.from === k ? e.to : null;
        if (next && !keep.has(next)) {
          keep.add(next);
          queue.push(next);
        }
      }
    }
  };
  walk("up");
  walk("down");
  return { nodes: nodes.filter((n) => keep.has(n.key)), edges: edges.filter((e) => keep.has(e.from) && keep.has(e.to)) };
}

export function layout(nodes: ChartNode[], edges: ChartEdge[]) {
  const keys = new Set(nodes.map((n) => n.key));
  const es = edges.filter((e) => keys.has(e.from) && keys.has(e.to) && e.from !== e.to);
  // Row = the longest chain of owners above (cycles are cut after a few passes).
  const row = new Map(nodes.map((n) => [n.key, 0]));
  for (let pass = 0; pass < nodes.length; pass += 1) {
    let changed = false;
    for (const e of es) {
      const want = row.get(e.from)! + 1;
      if (want > row.get(e.to)! && want <= nodes.length) {
        row.set(e.to, want);
        changed = true;
      }
    }
    if (!changed) break;
  }
  // Then move owners down to sit just above what they own, so lines don't
  // pass through other boxes (e.g. a person who owns only a company low down).
  for (let pass = 0; pass < nodes.length; pass += 1) {
    let changed = false;
    for (const n of nodes) {
      const below = es.filter((e) => e.from === n.key).map((e) => row.get(e.to)!);
      if (!below.length) continue;
      const want = Math.min(...below) - 1;
      if (want > row.get(n.key)!) {
        row.set(n.key, want);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const rows: string[][] = [];
  for (const n of nodes) (rows[row.get(n.key)!] ??= []).push(n.key);
  const order = new Map<string, number>();
  rows.forEach((r) => r.forEach((k, i) => order.set(k, i)));
  // Put each node under its owners (average position), two passes.
  for (let pass = 0; pass < 2; pass += 1) {
    for (let i = 1; i < rows.length; i += 1) {
      const r = rows[i] ?? [];
      const score = (k: string) => {
        const parents = es.filter((e) => e.to === k).map((e) => order.get(e.from) ?? 0);
        return parents.length ? parents.reduce((a, b) => a + b, 0) / parents.length : (order.get(k) ?? 0);
      };
      r.sort((a, b) => score(a) - score(b));
      r.forEach((k, j) => order.set(k, j));
    }
  }
  const widest = Math.max(1, ...rows.map((r) => r?.length ?? 0));
  const width = widest * BOX_W + (widest - 1) * GAP_X;
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const placed: PlacedNode[] = [];
  rows.forEach((r, i) => {
    if (!r) return;
    const rowWidth = r.length * BOX_W + (r.length - 1) * GAP_X;
    const left = (width - rowWidth) / 2;
    r.forEach((k, j) => placed.push({ ...byKey.get(k)!, row: i, x: left + j * (BOX_W + GAP_X), y: i * (BOX_H + GAP_Y) }));
  });
  const at = new Map(placed.map((p) => [p.key, p]));
  const placedEdges: PlacedEdge[] = es.map((e) => {
    const a = at.get(e.from)!;
    const b = at.get(e.to)!;
    return { ...e, x1: a.x + BOX_W / 2, y1: a.y + BOX_H, x2: b.x + BOX_W / 2, y2: b.y };
  });
  const height = rows.length ? rows.length * BOX_H + (rows.length - 1) * GAP_Y : 0;
  return { nodes: placed, edges: placedEdges, width, height };
}
