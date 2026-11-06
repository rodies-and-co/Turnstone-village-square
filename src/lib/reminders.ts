// Email reminders: when each person gets one, and what it says. Counts only,
// and no link to follow (owner, 5 Nov 2026), so a reminder can never be used
// to trick someone into signing in on a fake page. Pure (no database).

export type Frequency = "daily" | "weekly" | "off";
export const FREQUENCIES: Record<Frequency, string> = {
  weekly: "Weekly, on Monday morning",
  daily: "Every weekday morning",
  off: "No reminders",
};

export type Counts = {
  todos_overdue?: number;
  todos_this_week?: number;
  risk_reviews?: number;
  approvals?: number;
  stories_to_review?: number;
  my_stories_reviewed?: number;
};

// Is today (a London date, YYYY-MM-DD) a day this person gets a reminder?
export function dueToday(frequency: Frequency, londonDate: string) {
  const day = new Date(`${londonDate}T12:00:00Z`).getUTCDay(); // 0 Sunday … 6 Saturday
  if (frequency === "daily") return day >= 1 && day <= 5;
  if (frequency === "weekly") return day === 1;
  return false;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// The lines for one family, in plain words.
export function lines(c: Counts) {
  const out: string[] = [];
  if (c.todos_overdue) out.push(`${plural(c.todos_overdue, "to-do", "to-dos")} given to you ${c.todos_overdue === 1 ? "is" : "are"} overdue`);
  if (c.todos_this_week) out.push(`${plural(c.todos_this_week, "to-do", "to-dos")} given to you ${c.todos_this_week === 1 ? "is" : "are"} due in the next week`);
  if (c.risk_reviews) out.push(`${plural(c.risk_reviews, "risk you own is", "risks you own are")} due for review`);
  if (c.approvals) out.push(`${plural(c.approvals, "item is", "items are")} waiting for a Manager's approval`);
  if (c.stories_to_review) out.push(`${plural(c.stories_to_review, "story sent in by a family member is", "stories sent in by family members are")} waiting to be read`);
  if (c.my_stories_reviewed) out.push(`${plural(c.my_stories_reviewed, "story you sent in has", "stories you sent in have")} been read by the family's team`);
  return out;
}

export function total(c: Counts) {
  return Object.values(c).reduce((n, v) => n + (v ?? 0), 0);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function compose(name: string, families: { name: string; counts: Counts }[]) {
  const withItems = families.filter((f) => lines(f.counts).length);
  const subject = "Village Square: things waiting for you";
  const intro = `Hello ${name},`;
  const body = "Here is what is waiting for you in Village Square.";
  const close = [
    "To see them, sign in to Village Square the way you always do. This email has no link on purpose: Turnstone will never send you a link to sign in, so you can be sure an email like this is genuine.",
    "You can choose how often you get these, or turn them off, under Email reminders in Village Square.",
    "Turnstone",
  ];
  const text = [intro, "", body, "", ...withItems.flatMap((f) => [`${f.name}:`, ...lines(f.counts).map((l) => `- ${l}`), ""]), ...close.flatMap((c) => [c, ""])].join("\n").trim();
  const html = `<!doctype html><html lang="en-GB"><body style="font-family: Arial, sans-serif; color: #1d1d1b; line-height: 1.5; max-width: 560px;">
<p>${esc(intro)}</p><p>${esc(body)}</p>
${withItems.map((f) => `<p style="margin-bottom: 4px;"><strong>${esc(f.name)}</strong></p><ul style="margin-top: 0;">${lines(f.counts).map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`).join("\n")}
${close.map((c) => `<p>${esc(c)}</p>`).join("\n")}
</body></html>`;
  return { subject, text, html, items: withItems.reduce((n, f) => n + total(f.counts), 0) };
}
