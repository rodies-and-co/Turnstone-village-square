import Link from "next/link";
import { SubmitButton } from "@/components/feedback";
import { Field, Select } from "@/components/ui";
import { AUDIENCES, THEMES, excerpt, type Theme } from "@/lib/story";
import { dateText } from "@/lib/timeline";
import { TextArea } from "../meetings/DecisionsArea";
import { addStory, suggestStory } from "./actions";
import type { Chapter, Story } from "./story-data";

export type Look = { names: Map<string, string>; branches: [string, string][] };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// When it happened, as exactly as it is known.
export function WhenFields({ prefix, s }: { prefix: string; s?: Pick<Story, "happened_on" | "precision"> | null }) {
  const p = s?.happened_on ? s.precision : "year";
  return (
    <fieldset className="grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-2">
      <legend className="px-1 text-sm font-semibold text-ink">When it happened (if known)</legend>
      <p className="text-sm text-ink-2 sm:col-span-2">Give the exact date, or the month and year, or just the year – whatever is known.</p>
      <Field id={`${prefix}-year`} label="Year" name="year" type="number" defaultValue={s?.happened_on?.slice(0, 4)} hint="E.g. 1962." />
      <Select
        id={`${prefix}-month`}
        label="Month (if known)"
        name="month_only"
        includeBlank="Choose…"
        options={MONTHS.map((m, i) => [String(i + 1).padStart(2, "0"), m] as [string, string])}
        defaultValue={s?.happened_on && p !== "year" ? s.happened_on.slice(5, 7) : ""}
      />
      <Field id={`${prefix}-day`} label="Exact date (if known)" name="happened_on" type="date" defaultValue={p === "day" ? s?.happened_on : null} />
    </fieldset>
  );
}

export function ThemeBoxes({ prefix, chosen = [] }: { prefix: string; chosen?: Theme[] }) {
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-medium text-ink">Themes</legend>
      <div className="flex flex-wrap gap-x-5">
        {(Object.keys(THEMES) as Theme[]).map((t) => (
          <label key={t} className="flex min-h-11 items-center gap-2 text-sm text-ink">
            <input id={`${prefix}-theme-${t}`} type="checkbox" name="themes" value={t} defaultChecked={chosen.includes(t)} className="h-5 w-5" />
            {THEMES[t]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// The story itself (title, telling, when, where, themes, chapter).
export function StoryFields({ prefix, s, chapters, prompt }: { prefix: string; s?: Story | null; chapters: Chapter[]; prompt?: string }) {
  return (
    <div className="space-y-4">
      {(prompt ?? s?.prompt) && <input type="hidden" name="prompt" value={prompt ?? s?.prompt ?? ""} />}
      <Field id={`${prefix}-title`} label="Title" name="title" required defaultValue={s?.title} />
      <TextArea id={`${prefix}-body`} label="The story" name="body" rows={8} defaultValue={s?.body} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${prefix}-told`} label="Told by" name="told_by" defaultValue={s?.told_by} hint="E.g. “Told by her daughter, 2026”." />
        <Field id={`${prefix}-place`} label="Where" name="place" defaultValue={s?.place} />
        <Select id={`${prefix}-chapter`} label="Chapter of the family story" name="chapter_id" options={chapters.map((c) => [c.id, c.title] as [string, string])} includeBlank="Not in a chapter" defaultValue={s?.chapter_id} />
      </div>
      <WhenFields prefix={prefix} s={s} />
      <ThemeBoxes prefix={prefix} chosen={s?.themes} />
    </div>
  );
}

export function AudienceFields({ prefix, s, look }: { prefix: string; s?: Pick<Story, "audience" | "branch_id"> | null; look: Look }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Select id={`${prefix}-audience`} label="Who may read it" name="audience" options={AUDIENCES} defaultValue={s?.audience ?? "family"} />
      <Select id={`${prefix}-branch`} label="Branch (if one branch)" name="branch_id" options={look.branches} includeBlank="Choose…" defaultValue={s?.branch_id} />
    </div>
  );
}

export function AddStoryForm({ familyId, back, chapters, look, about, chapterId, prompt, n }: { familyId: string; back: string; chapters: Chapter[]; look: Look; about?: string; chapterId?: string; prompt?: string; n?: number }) {
  const people = [...look.names.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const prefix = `new${about ? `-${about.slice(0, 8)}` : ""}${chapterId ? `-${chapterId.slice(0, 8)}` : ""}${n !== undefined ? `-p${n}` : ""}`;
  return (
    <form action={addStory.bind(null, familyId, back)} className="space-y-4">
      <StoryFields prefix={prefix} chapters={chapters} prompt={prompt} s={chapterId ? ({ chapter_id: chapterId } as Story) : null} />
      <AudienceFields prefix={prefix} look={look} />
      {about ? (
        <input type="hidden" name="people" value={about} />
      ) : (
        <div>
          <label htmlFor={`${prefix}-people`} className="mb-1 block text-sm font-medium text-ink">
            People it is about
          </label>
          <select id={`${prefix}-people`} name="people" multiple size={Math.min(6, Math.max(3, people.length))} className="text-input h-auto">
            {people.map(([id, n]) => (
              <option key={id} value={id}>
                {n}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-ink-3">Optional, unless only they may read it. Hold Ctrl (or Cmd on a Mac) to choose more than one.</p>
        </div>
      )}
      <SubmitButton>Add the story</SubmitButton>
    </form>
  );
}

// A family member's own story, sent in for the team to review.
export function SuggestForm({ familyId, back, prompt, n }: { familyId: string; back: string; prompt?: string; n?: number }) {
  const prefix = `tell${n !== undefined ? `-p${n}` : ""}`;
  return (
    <form action={suggestStory.bind(null, familyId, back)} className="space-y-4">
      {prompt && <input type="hidden" name="prompt" value={prompt} />}
      <Field id={`${prefix}-title`} label="Title" name="title" required />
      <TextArea id={`${prefix}-body`} label="Your story" name="body" rows={8} />
      <Field id={`${prefix}-place`} label="Where (if it matters)" name="place" />
      <WhenFields prefix={prefix} />
      <p className="text-sm text-ink-2">The family&apos;s team reads it first, then adds it. Until then only you and the team can see it.</p>
      <SubmitButton>Send my story</SubmitButton>
    </form>
  );
}

export function StoryCard({ s, familyId, look }: { s: Story; familyId: string; look: Look }) {
  return (
    <li className="py-4">
      <p className="text-sm text-ink-3">
        {[s.happened_on ? dateText(s.happened_on, s.precision) : null, s.place, s.people.map((p) => look.names.get(p)).filter(Boolean).join(", ") || null].filter(Boolean).join(" · ")}
      </p>
      <Link href={`/families/${familyId}/story/${s.id}`} className="inline-flex min-h-11 items-center text-[16px] font-semibold text-ink hover:underline">
        {s.title}
      </Link>
      <p className="text-[15px] leading-relaxed text-ink-2">{excerpt(s.body)}</p>
      {s.themes.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2" aria-label="Themes">
          {s.themes.map((t) => (
            <li key={t} className="rounded-full border border-border bg-white px-2.5 py-0.5 text-xs text-ink">
              {THEMES[t]}
            </li>
          ))}
        </ul>
      )}
      {s.status !== "published" && (
        <p className="mt-2 text-sm font-medium text-ink">{s.status === "suggested" ? "Sent in – waiting for the team" : `Not added${s.review_note ? `: ${s.review_note}` : ""}`}</p>
      )}
    </li>
  );
}
