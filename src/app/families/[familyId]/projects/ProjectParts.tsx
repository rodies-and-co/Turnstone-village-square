import { percent, progressText } from "@/lib/projects";

// A progress bar with its numbers written out, so the bar never carries the
// meaning alone.
export function ProgressBar({ done, total, label, size = "md" }: { done: number; total: number; label: string; size?: "md" | "lg" }) {
  const pct = percent(done, total);
  return (
    <div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={progressText(done, total)}
        className={`w-full overflow-hidden rounded-full border border-border bg-white ${size === "lg" ? "h-4" : "h-2.5"}`}
      >
        <div className="h-full rounded-full bg-[#2f5d50]" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-sm text-ink-2">{progressText(done, total)}</p>
    </div>
  );
}

export function aboutOf(p: { entity_id: string | null; branch_id: string | null }, look: { entities: Map<string, string>; branches: Map<string, string> }) {
  if (p.entity_id) return look.entities.get(p.entity_id) ?? "An entity";
  if (p.branch_id) return look.branches.get(p.branch_id) ?? "A branch";
  return "The whole family";
}
