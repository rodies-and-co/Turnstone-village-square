import Link from "next/link";
import { SubmitButton } from "@/components/feedback";
import { Field, Select } from "@/components/ui";
import { formatDate } from "@/lib/governance";
import { BAND_STYLE, BANDS, IMPACT, LIKELIHOOD, RESPONSES, band, describe, heatGrid, type Band, type Rating } from "@/lib/risk";
import { TextArea } from "../meetings/DecisionsArea";
import { addRisk } from "./actions";
import { aboutText, categoryText, type Category, type Risk } from "./risk-data";

export type Look = { entities: Map<string, string>; branches: Map<string, string>; names: Map<string, string> };

export function BandChip({ band, score, prefix }: { band: Band; score: number; prefix?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${BAND_STYLE[band]}`}>
      {prefix ? `${prefix} ` : ""}
      {BANDS[band]} ({score})
    </span>
  );
}

// The category as one field: the category on its own, or with a subcategory.
export function CategorySelect({ cats, defaultValue, id = "category" }: { cats: Category[]; defaultValue?: string; id?: string }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-ink">
        Category (required)
      </label>
      <select id={id} name="category" required defaultValue={defaultValue ?? ""} className="text-input">
        <option value="" disabled>
          Choose…
        </option>
        {cats
          .filter((c) => c.active || c.key === defaultValue?.split("|")[0])
          .map((c) => (
            <optgroup key={c.key} label={c.name}>
              <option value={c.key}>{c.name} (general)</option>
              {c.subcategories.map((s) => (
                <option key={s} value={`${c.key}|${s}`}>
                  {s}
                </option>
              ))}
            </optgroup>
          ))}
      </select>
    </div>
  );
}

const scoreOptions = (labels: Record<number, string>) => [1, 2, 3, 4, 5].map((n) => [String(n), `${n} – ${labels[n]}`] as [string, string]);

// Likelihood and impact before controls (inherent) and after them (residual).
export function RatingFields({ r, prefix, optional }: { r?: (Rating & { controls?: string | null; notes?: string | null; reviewed_on?: string }) | null; prefix: string; optional?: boolean }) {
  const blank = optional ? "Not rated yet" : "Choose…";
  return (
    <fieldset className="space-y-4 rounded-lg border border-border p-4">
      <legend className="px-1 text-sm font-semibold text-ink">Rating{optional ? " (you can rate it later)" : ""}</legend>
      <div className="grid gap-4 sm:grid-cols-2">
        <Select id={`${prefix}-il`} label="Likelihood before controls" name="inherent_likelihood" options={scoreOptions(LIKELIHOOD)} includeBlank={blank} defaultValue={r ? String(r.inherent_likelihood) : null} />
        <Select id={`${prefix}-ii`} label="Impact before controls" name="inherent_impact" options={scoreOptions(IMPACT)} includeBlank={blank} defaultValue={r ? String(r.inherent_impact) : null} />
        <Select id={`${prefix}-rl`} label="Likelihood after controls" name="residual_likelihood" options={scoreOptions(LIKELIHOOD)} includeBlank={blank} defaultValue={r ? String(r.residual_likelihood) : null} />
        <Select id={`${prefix}-ri`} label="Impact after controls" name="residual_impact" options={scoreOptions(IMPACT)} includeBlank={blank} defaultValue={r ? String(r.residual_impact) : null} />
      </div>
      <TextArea id={`${prefix}-controls`} label="Controls (what is in place to reduce it)" name="controls" defaultValue={r?.controls} rows={3} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${prefix}-on`} label="Date of the rating" name="reviewed_on" type="date" defaultValue={r?.reviewed_on} hint="Today, if left empty." />
      </div>
      <TextArea id={`${prefix}-notes`} label="Notes" name="notes" defaultValue={r?.notes} rows={2} />
    </fieldset>
  );
}

export function aboutOptions(look: Look, allowPeople = true) {
  return [
    ...[...look.entities.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([id, n]) => [`entity:${id}`, n] as [string, string]),
    ...[...look.branches.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([id, n]) => [`branch:${id}`, n] as [string, string]),
    ...(allowPeople ? [...look.names.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([id, n]) => [`person:${id}`, n] as [string, string]) : []),
  ];
}
export const aboutValue = (r: Pick<Risk, "entity_id" | "branch_id" | "person_id">) =>
  r.entity_id ? `entity:${r.entity_id}` : r.branch_id ? `branch:${r.branch_id}` : r.person_id ? `person:${r.person_id}` : "";

// The risk's own details (not its rating).
export function DetailFields({
  cats,
  look,
  team,
  me,
  r,
  prefix,
  fixedAbout,
  canChangeAbout = true,
}: {
  cats: Category[];
  look: Look;
  team: Map<string, string>;
  me: string;
  r?: Partial<Risk> | null;
  prefix: string;
  fixedAbout?: string;
  canChangeAbout?: boolean;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field id={`${prefix}-title`} label="The risk, in a few words" name="title" required defaultValue={r?.title} />
      </div>
      <div className="sm:col-span-2">
        <TextArea id={`${prefix}-description`} label="What could happen, and why" name="description" defaultValue={r?.description} rows={3} />
      </div>
      <CategorySelect id={`${prefix}-category`} cats={cats} defaultValue={r?.category ? (r.subcategory ? `${r.category}|${r.subcategory}` : r.category) : undefined} />
      {fixedAbout !== undefined ? (
        <input type="hidden" name="about" value={fixedAbout} />
      ) : canChangeAbout ? (
        <Select
          id={`${prefix}-about`}
          label="About"
          name="about"
          includeBlank="The whole family"
          options={aboutOptions(look)}
          defaultValue={r ? aboutValue(r as Risk) : ""}
          hint="Who may see it follows this. Risks about a person are seen by Managers and Administrators only."
        />
      ) : (
        <div>
          <p className="mb-1 text-sm font-medium text-ink">About</p>
          <p className="text-ink">{r ? aboutText(r as Risk, look) : "The whole family"}</p>
          <p className="mt-1 text-xs text-ink-3">Only a Manager can change this, because it changes who sees the risk.</p>
        </div>
      )}
      <Select id={`${prefix}-response`} label="How it is handled" name="response" options={RESPONSES} defaultValue={r?.response ?? "treat"} />
      <Select
        id={`${prefix}-owner`}
        label="Owner"
        name="owner_id"
        options={[
          ...[...team.entries()].map(([id, n]) => [id, id === me ? `${n} (me)` : n] as [string, string]),
          ...(r?.owner_id && !team.has(r.owner_id) ? ([[r.owner_id, "A former team member (choose someone new)"]] as [string, string][]) : []),
        ]}
        includeBlank="Nobody yet"
        defaultValue={r ? (r.owner_id ?? "") : me}
      />
      <Field id={`${prefix}-review`} label="Next review" name="next_review_on" type="date" defaultValue={r?.next_review_on} hint="A year after each approved rating, if left empty." />
    </div>
  );
}

export function AddRiskForm({
  familyId,
  back,
  cats,
  look,
  team,
  me,
  fixedAbout,
}: {
  familyId: string;
  back: string;
  cats: Category[];
  look: Look;
  team: Map<string, string>;
  me: string;
  fixedAbout?: string;
}) {
  return (
    <form action={addRisk.bind(null, familyId, back)} className="space-y-4">
      <DetailFields cats={cats} look={look} team={team} me={me} prefix="new" fixedAbout={fixedAbout} />
      <RatingFields prefix="new" optional />
      <SubmitButton>Add to the register</SubmitButton>
    </form>
  );
}

// One line per risk: its rating after controls, what it is about, its owner and review.
export function RiskList({ risks, familyId, cats, look, team, now, hideAbout }: { risks: Risk[]; familyId: string; cats: Map<string, Category>; look: Look; team: Map<string, string>; now: string; hideAbout?: boolean }) {
  if (risks.length === 0) return <p className="border-y border-border py-3 text-ink-3">No risks here.</p>;
  return (
    <ul className="divide-y divide-border border-y border-border">
      {risks.map((r) => {
        const d = r.current ? describe(r.current, "residual") : null;
        const overdue = r.status === "open" && r.next_review_on && r.next_review_on < now;
        return (
          <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
            <div className="min-w-0">
              <Link href={`/families/${familyId}/risks/${r.id}`} className="text-[15px] font-medium text-ink hover:underline">
                {r.title}
              </Link>
              <p className="text-sm text-ink-3">
                {[
                  categoryText(cats, r.category, r.subcategory),
                  hideAbout ? null : aboutText(r, look),
                  // Viewers don't see the team, so the owner isn't shown to them.
                  r.owner_id && team.size ? `Owner: ${team.get(r.owner_id) ?? "a former team member"}` : null,
                  r.status === "closed"
                    ? `Closed ${formatDate(r.closed_on)}`
                    : r.next_review_on
                      ? overdue
                        ? `Review overdue – was due ${formatDate(r.next_review_on)}`
                        : `Next review ${formatDate(r.next_review_on)}`
                      : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {d ? <BandChip band={d.band} score={d.score} prefix="After controls:" /> : <span className="text-sm text-ink-3">Not rated yet</span>}
              {r.draft && <span className="rounded-full bg-bronze px-2.5 py-0.5 text-xs font-medium text-ink">New rating waiting for approval</span>}
              {r.status === "closed" && <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-ink">Closed</span>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// A 5 x 5 heat map: impact up the side, likelihood along the bottom. Each
// square says its band and how many risks are in it; a list follows.
export function HeatMap({ ratings, which, title }: { ratings: Rating[]; which: "inherent" | "residual"; title: string }) {
  const grid = heatGrid(ratings, which);
  return (
    <figure>
      <figcaption className="mb-2 text-sm font-semibold text-ink">{title}</figcaption>
      <table className="w-full table-fixed border-separate border-spacing-1 text-sm">
        <caption className="sr-only">
          {title}: number of risks by impact (rows, severe at the top) and likelihood (columns, rare on the left)
        </caption>
        <tbody>
          {[5, 4, 3, 2, 1].map((impact) => (
            <tr key={impact}>
              <th scope="row" className="w-16 break-words pr-1 text-right text-[11px] font-normal text-ink-2 sm:w-24 sm:text-xs">
                {impact} {IMPACT[impact]}
              </th>
              {[1, 2, 3, 4, 5].map((l) => {
                const s = l * impact;
                const b = band(s);
                const n = grid[impact - 1][l - 1];
                return (
                  <td key={l} className={`h-14 rounded text-center align-middle ${BAND_STYLE[b]}`} title={`${BANDS[b]} (${s}): ${n} ${n === 1 ? "risk" : "risks"}`}>
                    <span className="block text-lg font-bold">{n || ""}</span>
                    <span className="sr-only">
                      {LIKELIHOOD[l]}, {IMPACT[impact]}: {BANDS[b]} ({s}), {n} {n === 1 ? "risk" : "risks"}
                    </span>
                    <span aria-hidden="true" className="block text-[10px] uppercase tracking-wide opacity-80">
                      {BANDS[b]}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
          <tr>
            <td />
            {[1, 2, 3, 4, 5].map((l) => (
              <th key={l} scope="col" className="pt-1 text-xs font-normal text-ink-2">
                {l} {LIKELIHOOD[l]}
              </th>
            ))}
          </tr>
        </tbody>
      </table>
      <p className="mt-1 text-center text-xs text-ink-3">Likelihood →  ·  Impact ↑</p>
    </figure>
  );
}
