// The calendar's month grid and the to-do list's order. Pure, so it can be
// tested on its own.

const pad = (n: number) => String(n).padStart(2, "0");
export const isMonth = (m: string | undefined): m is string => Boolean(m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m));

export function shiftMonth(month: string, by: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

export function monthName(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

// The weeks shown for a month, Monday first (the British way), with the days
// of the months either side to fill the first and last week.
export function monthGrid(month: string): string[][] {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const back = (first.getUTCDay() + 6) % 7; // days since Monday
  const start = new Date(first);
  start.setUTCDate(1 - back);
  const weeks: string[][] = [];
  const d = new Date(start);
  do {
    const week: string[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(d.toISOString().slice(0, 10));
      d.setUTCDate(d.getUTCDate() + 1);
    }
    weeks.push(week);
  } while (d.getUTCMonth() === m - 1);
  return weeks;
}

// Entries that fall on a day, including entries that run over several days.
export function on<T extends { date: string; endDate?: string | null }>(day: string, entries: T[]) {
  return entries.filter((e) => e.date === day || (e.endDate && e.date <= day && day <= e.endDate));
}

// Entries that touch a month.
export function inMonth<T extends { date: string; endDate?: string | null }>(month: string, entries: T[]) {
  const first = `${month}-01`;
  const last = `${shiftMonth(month, 1)}-01`;
  return entries.filter((e) => (e.date >= first && e.date < last) || (e.endDate && e.date < last && e.endDate >= first));
}

// To-do order: overdue first, then by due date (no date last), then high
// priority first.
const rank = { high: 0, normal: 1, low: 2 } as const;
export function byDue<T extends { due: string | null; priority?: keyof typeof rank }>(a: T, b: T) {
  if (a.due && b.due && a.due !== b.due) return a.due.localeCompare(b.due);
  if (a.due && !b.due) return -1;
  if (!a.due && b.due) return 1;
  return rank[a.priority ?? "normal"] - rank[b.priority ?? "normal"];
}

// The London date of a moment in time (e.g. when a to-do was marked done).
export function londonDate(ts: string | null | undefined) {
  if (!ts) return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}
