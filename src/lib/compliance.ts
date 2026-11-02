// The Organisation: compliance. Works out each entity's filings calendar and
// the notices due after events, from the obligations in its Entity Standard.
// Pure functions, no database access, so they can be tested on their own.
// Dates are plain "YYYY-MM-DD" strings (no time zones).

export type Obligation = {
  key: string;
  name: string;
  authority: string | null;
  kind: "recurring" | "event";
  basis: "anniversary" | "year_end" | "fixed_date" | "half_year" | null;
  offset_months: number;
  offset_days: number;
  business_days: boolean;
  fixed_month: number | null;
  fixed_day: number | null;
  alt_month: number | null;
  alt_day: number | null;
  event_type: "officer_change" | "member_change" | "share_issue" | "bo_change" | null;
  event_roles: string[] | null;
  to_confirm: boolean;
  notes: string | null;
};

export type ComplianceEntity = {
  id: string;
  registered_on: string | null;
  year_end_month: number | null;
  year_end_day: number | null;
  status: string;
  dissolved_on?: string | null;
  // Filings are tracked from this date (earlier periods aren't shown).
  track_from: string;
};

// Something that happened which may need a notice: e.g. a director appointed.
export type ComplianceEvent = {
  type: "officer_change" | "member_change" | "share_issue" | "bo_change";
  date: string;
  key: string; // stable, e.g. "appt:<id>:start"
  label: string;
  role?: string;
};

export type Filing = {
  id: string;
  obligation_key: string;
  due_date: string;
  period_key: string | null;
  event_key: string | null;
  status: "filed" | "not_applicable";
  done_on: string | null;
  reference: string | null;
  notes?: string | null;
};

export type Status = "filed" | "not_applicable" | "overdue" | "due_soon" | "upcoming";

export type CalendarItem = {
  obligation: Obligation;
  due: string;
  period: string | null; // e.g. "Year ended 31 Mar 2026"
  periodKey: string | null; // e.g. "2026-03-31": what a filing record is matched by
  event: ComplianceEvent | null;
  status: Status;
  filing: Filing | null;
};

export type CalendarProblem = { obligation: Obligation; reason: string };

// --- Dates -------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, "0");
export const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const parts = (d: string) => d.split("-").map(Number) as [number, number, number];
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
// A day of a month, kept inside the month (29 Feb becomes 28 Feb in other years).
export const dayOf = (y: number, m: number, d: number) => iso(y, m, Math.min(d, daysIn(y, m)));

// The same day of the month, months later (kept inside shorter months: 31 Jan
// + 1 month = 28 Feb). On purpose, the end of a month doesn't move to the end
// of a longer one (30 Sep + 1 month = 30 Oct): the earlier date is the safer one.
export function addMonths(date: string, months: number) {
  const [y, m, d] = parts(date);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return dayOf(ny, nm, d);
}

export function addDays(date: string, days: number) {
  const [y, m, d] = parts(date);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

// Monday to Friday only (public holidays aren't counted).
export function addBusinessDays(date: string, days: number) {
  let out = date;
  let left = days;
  while (left > 0) {
    out = addDays(out, 1);
    const [y, m, d] = parts(out);
    const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (wd !== 0 && wd !== 6) left -= 1;
  }
  return out;
}

export function applyOffset(date: string, o: Pick<Obligation, "offset_months" | "offset_days" | "business_days">) {
  const afterMonths = addMonths(date, o.offset_months);
  return o.business_days ? addBusinessDays(afterMonths, o.offset_days) : addDays(afterMonths, o.offset_days);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const shortDate = (d: string) => {
  const [y, m, dd] = parts(d);
  return `${dd} ${MONTHS[m - 1]} ${y}`;
};

// "Within 1 month and 1 day after the year end", in words.
export function describeRule(o: Obligation) {
  const bits: string[] = [];
  if (o.offset_months) bits.push(`${o.offset_months} ${o.offset_months === 1 ? "month" : "months"}`);
  if (o.offset_days) bits.push(`${o.offset_days} ${o.business_days ? "business " : ""}${o.offset_days === 1 ? "day" : "days"}`);
  const within = bits.length ? `Within ${bits.join(" and ")} after ` : "On ";
  const fixed = (m: number | null, d: number | null) => (m && d ? `${d} ${MONTHS[m - 1]}` : "");
  switch (o.basis) {
    case "anniversary":
      return `${within}each anniversary of registration`;
    case "year_end":
      return `${within}each financial year end`;
    case "fixed_date":
      return `Every year by ${fixed(o.fixed_month, o.fixed_day)}`;
    case "half_year":
      return `Every year by ${fixed(o.fixed_month, o.fixed_day)} (registered January–June) or ${fixed(o.alt_month, o.alt_day)} (July–December)`;
    default: {
      const what = { officer_change: "an appointment or resignation", member_change: "a change of members", share_issue: "an issue of shares", bo_change: "a change of beneficial owners" };
      return `${bits.length ? within : "As soon as possible after "}${what[o.event_type ?? "officer_change"]}`;
    }
  }
}

// --- The calendar ----------------------------------------------------------------

// The dates a recurring obligation falls due between `from` and `to`, for one
// entity, with the period each is for. Only periods after the entity was
// registered count:
// - the first financial year end is at least 6 months after registration
//   (a first period is rarely shorter; first accounts often have longer);
// - a fixed-date filing (e.g. a fee by 20 January) starts a month after
//   registration, and a half-year one (BVI fee) the following year.
export function recurringDates(o: Obligation, e: Pick<ComplianceEntity, "registered_on" | "year_end_month" | "year_end_day">, from: string, to: string): { due: string; period: string | null; periodKey: string }[] | string {
  const [fy] = parts(from);
  const [ty] = parts(to);
  const out: { due: string; period: string | null; periodKey: string }[] = [];
  const reg = e.registered_on;
  for (let y = fy - 2; y <= ty + 1; y += 1) {
    let due: string;
    let period: string | null = null;
    let periodKey: string;
    if (o.basis === "anniversary") {
      if (!reg) return "Needs the date of registration (on the Overview).";
      const [ry, rm, rd] = parts(reg);
      if (y <= ry) continue;
      const anniversary = dayOf(y, rm, rd);
      period = `Anniversary ${shortDate(anniversary)}`;
      periodKey = anniversary;
      due = applyOffset(anniversary, o);
    } else if (o.basis === "year_end") {
      if (!e.year_end_month || !e.year_end_day) return "Needs the financial year end (on the Overview).";
      const ye = dayOf(y, e.year_end_month, e.year_end_day);
      if (reg && ye < addMonths(reg, 6)) continue;
      period = `Year ended ${shortDate(ye)}`;
      periodKey = ye;
      due = applyOffset(ye, o);
    } else if (o.basis === "fixed_date") {
      due = dayOf(y, o.fixed_month ?? 1, o.fixed_day ?? 1);
      period = String(y);
      periodKey = String(y);
      if (reg && due < addMonths(reg, 1)) continue;
    } else if (o.basis === "half_year") {
      if (!reg) return "Needs the date of registration (on the Overview).";
      const firstHalf = parts(reg)[1] <= 6;
      due = firstHalf ? dayOf(y, o.fixed_month ?? 5, o.fixed_day ?? 31) : dayOf(y, o.alt_month ?? 11, o.alt_day ?? 30);
      period = String(y);
      periodKey = String(y);
      if (due < addMonths(reg, 12)) continue;
    } else {
      continue;
    }
    if (due >= from && due <= to) out.push({ due, period, periodKey });
  }
  return out;
}

// Does this event call for this obligation?
// Roles whose holders are beneficial owners of a trust or foundation: a change
// of them is a change of beneficial owners.
const BO_ROLES = ["trustee", "protector", "enforcer", "council_member", "general_partner"];

export function eventMatches(o: Obligation, ev: ComplianceEvent) {
  if (o.kind !== "event" || !o.event_type) return false;
  if (o.event_type === "bo_change")
    return ev.type === "bo_change" || ev.type === "member_change" || ev.type === "share_issue" || (ev.type === "officer_change" && BO_ROLES.includes(ev.role ?? ""));
  if (o.event_type === "member_change") return ev.type === "member_change" || ev.type === "share_issue";
  if (o.event_type !== ev.type) return false;
  if (o.event_type === "officer_change" && o.event_roles?.length) return Boolean(ev.role && o.event_roles.includes(ev.role));
  return true;
}

const SOON_DAYS = 60;

function status(due: string, filing: Filing | null, today: string): Status {
  if (filing) return filing.status;
  if (due < today) return "overdue";
  if (due <= addDays(today, SOON_DAYS)) return "due_soon";
  return "upcoming";
}

// The calendar for one entity: recurring filings and notices for events from
// when filings are tracked (or registration) to 15 months ahead, stopping at
// dissolution. What has been recorded (filed or not applicable) is matched by
// obligation and period, or by obligation and event.
export function entityCalendar(
  e: ComplianceEntity,
  obligations: Obligation[],
  events: ComplianceEvent[],
  filings: Filing[],
  today: string,
): { items: CalendarItem[]; problems: CalendarProblem[] } {
  const items: CalendarItem[] = [];
  const problems: CalendarProblem[] = [];
  const from = e.registered_on && e.registered_on > e.track_from ? e.registered_on : e.track_from;
  let to = addMonths(today, 15);
  if (e.status === "dissolved") {
    if (!e.dissolved_on) return { items, problems };
    to = e.dissolved_on < to ? e.dissolved_on : to;
  }

  for (const o of obligations) {
    if (o.kind === "recurring") {
      const dates = recurringDates(o, e, from, to);
      if (typeof dates === "string") {
        problems.push({ obligation: o, reason: dates });
        continue;
      }
      for (const d of dates) {
        const filing =
          filings.find((f) => f.obligation_key === o.key && f.event_key === null && (f.period_key ? f.period_key === d.periodKey : f.due_date === d.due)) ?? null;
        items.push({ obligation: o, due: d.due, period: d.period, periodKey: d.periodKey, event: null, status: status(d.due, filing, today), filing });
      }
    } else {
      const seen = new Set<string>();
      for (const ev of events) {
        if (ev.date < from || ev.date > to || !eventMatches(o, ev)) continue;
        // One notice per event, even if it matches in two ways.
        if (seen.has(ev.key)) continue;
        seen.add(ev.key);
        const due = applyOffset(ev.date, o);
        const filing = filings.find((f) => f.obligation_key === o.key && f.event_key === ev.key) ?? null;
        items.push({ obligation: o, due, period: null, periodKey: null, event: ev, status: status(due, filing, today), filing });
      }
    }
  }
  items.sort((a, b) => a.due.localeCompare(b.due) || a.obligation.name.localeCompare(b.obligation.name));
  return { items, problems };
}

export const STATUS_LABELS: Record<Status, string> = {
  overdue: "Overdue",
  due_soon: "Due soon",
  upcoming: "Upcoming",
  filed: "Filed",
  not_applicable: "Not applicable",
};
