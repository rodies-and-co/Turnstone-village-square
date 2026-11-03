import "server-only";
import type { FamilyContext } from "@/lib/family-context";
import { displayNames, type PersonSummary } from "@/lib/people";
import type { Rating, Response } from "@/lib/risk";

// The family's one risk register (decision 1.2). Categories come from the hub
// (shared by every family); risks and ratings from the family's own database.
// Every read runs as the signed-in person.

export type Category = {
  key: string;
  name: string;
  description: string | null;
  subcategories: string[];
  sort: number;
  active: boolean;
  to_confirm: boolean;
};

export type Review = Rating & {
  id: string;
  risk_id: string;
  reviewed_on: string;
  controls: string | null;
  notes: string | null;
  status: "draft" | "approved";
  prepared_by: string | null;
  changed_by: string[];
  approved_by: string | null;
  approved_at: string | null;
};

export type Risk = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  subcategory: string | null;
  entity_id: string | null;
  branch_id: string | null;
  person_id: string | null;
  response: Response;
  owner_id: string | null;
  next_review_on: string | null;
  status: "open" | "closed";
  closed_on: string | null;
  closed_reason: string | null;
  suggestion_key: string | null;
  created_at: string;
  reviews: Review[];
  current: Review | null; // the latest approved rating
  draft: Review | null; // a rating waiting for approval
};

export async function loadCategories(ctx: FamilyContext) {
  const { data } = await ctx.supabase.from("risk_categories").select("*").order("sort").order("name");
  return (data ?? []) as Category[];
}

export function latest(reviews: Review[]) {
  return (
    reviews
      .filter((v) => v.status === "approved")
      .sort((a, b) => b.reviewed_on.localeCompare(a.reviewed_on) || (b.approved_at ?? "").localeCompare(a.approved_at ?? ""))[0] ?? null
  );
}

export async function loadRisks(ctx: FamilyContext, filter?: { entityId?: string; personId?: string; riskId?: string }) {
  let q = ctx.db!.from("risks").select("*, risk_reviews(*)").order("created_at");
  if (filter?.entityId) q = q.eq("entity_id", filter.entityId);
  if (filter?.personId) q = q.eq("person_id", filter.personId);
  if (filter?.riskId) q = q.eq("id", filter.riskId);
  const { data } = await q;
  return ((data ?? []) as (Omit<Risk, "reviews" | "current" | "draft"> & { risk_reviews: Review[] })[]).map(({ risk_reviews, ...r }) => {
    const reviews = [...(risk_reviews ?? [])].sort((a, b) => b.reviewed_on.localeCompare(a.reviewed_on) || b.status.localeCompare(a.status));
    return { ...r, reviews, current: latest(reviews), draft: reviews.find((v) => v.status === "draft") ?? null } as Risk;
  });
}

// What the risk is about, in words.
export function aboutText(r: Pick<Risk, "entity_id" | "branch_id" | "person_id">, look: { entities: Map<string, string>; branches: Map<string, string>; names: Map<string, string> }) {
  if (r.entity_id) return look.entities.get(r.entity_id) ?? "An entity";
  if (r.branch_id) return `${look.branches.get(r.branch_id) ?? "A branch"}`;
  if (r.person_id) return look.names.get(r.person_id) ?? "A person";
  return "The whole family";
}

export function categoryText(cats: Map<string, Category>, key: string, sub?: string | null) {
  const name = cats.get(key)?.name ?? "Category no longer listed";
  return sub ? `${name} › ${sub}` : name;
}

// Names for what risks are about: entities, branches and people.
export async function loadLook(ctx: FamilyContext) {
  const [{ data: e }, { data: b }, { data: p }] = await Promise.all([
    ctx.db!.from("entities").select("id, name").order("name"),
    ctx.db!.from("branches").select("id, name").order("name"),
    ctx.db!.from("people").select("id, full_names, surname, known_as, birth_year").order("surname"),
  ]);
  return {
    entities: new Map(((e ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name])),
    branches: new Map(((b ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name])),
    names: displayNames((p ?? []) as PersonSummary[]),
  };
}
