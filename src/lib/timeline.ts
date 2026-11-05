// The family / branch timeline: kinds, dates and grouping. Pure helpers (no
// database), shared by pages and tests.

export const TIMELINE_KINDS = {
  family: "Family life",
  entities: "Entities & ownership",
  governance: "Governance",
  stories: "Stories",
  added: "Added by hand",
} as const;
export type TimelineKind = keyof typeof TIMELINE_KINDS;
export const KIND_MARK: Record<TimelineKind, string> = { family: "F", entities: "E", governance: "G", stories: "S", added: "A" };

export type Precision = "day" | "month" | "year";
export type TimelineItem = {
  key: string;
  kind: TimelineKind;
  date: string; // YYYY-MM-DD (for a year alone, 1 January)
  precision: Precision;
  title: string;
  detail?: string | null;
  href?: string;
  personIds: string[];
  entityId?: string | null;
  branchId?: string | null;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// "2 November 2026", "November 2026" or "2026".
export function dateText(date: string, precision: Precision) {
  const [y, m, d] = date.split("-").map(Number);
  if (precision === "year") return String(y);
  if (precision === "month") return `${MONTHS[m - 1]} ${y}`;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

// Which kinds to show: ticked boxes, or everything on a first visit. A form
// sent with nothing ticked (show="" present) shows nothing.
export function parseKinds(kinds: string | string[] | undefined, show?: string): TimelineKind[] {
  if (show === "" && !kinds) return [];
  const all = Object.keys(TIMELINE_KINDS) as TimelineKind[];
  const picked = [...(Array.isArray(kinds) ? kinds : kinds ? [kinds] : []), ...(show ? show.split(",") : [])].filter((k): k is TimelineKind =>
    (all as string[]).includes(k),
  );
  return picked.length ? [...new Set(picked)] : all;
}

// Filter by kind, branch, person and words; then group by year.
export function arrange(
  items: TimelineItem[],
  o: { kinds: TimelineKind[]; branchOf?: (i: TimelineItem) => boolean; personId?: string; words?: string; newestFirst?: boolean },
) {
  const words = (o.words ?? "").trim().toLowerCase();
  const kept = items
    .filter((i) => o.kinds.includes(i.kind))
    .filter((i) => !o.personId || i.personIds.includes(o.personId))
    .filter((i) => !o.branchOf || o.branchOf(i))
    .filter((i) => !words || `${i.title} ${i.detail ?? ""}`.toLowerCase().includes(words))
    .sort((a, b) => (o.newestFirst ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)) || a.title.localeCompare(b.title));
  const years: [string, TimelineItem[]][] = [];
  for (const i of kept) {
    const y = i.date.slice(0, 4);
    const last = years[years.length - 1];
    if (last && last[0] === y) last[1].push(i);
    else years.push([y, [i]]);
  }
  return { count: kept.length, years };
}
