import Link from "next/link";
import { ENTITY_TYPES, type EntityType } from "@/lib/entity-checklist";
import { holderFrom, holderKey, type Holder } from "@/lib/ownership";
import {
  BOX_H,
  BOX_W,
  connected,
  layout,
  type ChartEdge,
  type ChartNode,
} from "@/lib/structure";
import type { OrganisationData } from "./organisation-data";

const round = (n: number) => `${Math.round(n * 100) / 100}%`;
const short = (s: string, n = 28) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;

// The boxes and lines: every entity, and whoever holds shares in one or
// settled or founded one. Family entities that act as trustee or council
// member are linked with a dashed line.
export function chartFromData(
  data: OrganisationData,
  nameOf: (h: Holder | null) => string,
  familyId: string,
  visiblePeople?: Set<string>,
) {
  const nodes = new Map<string, ChartNode>();
  const edges: ChartEdge[] = [];
  for (const e of data.entities) {
    nodes.set(`entity:${e.id}`, {
      key: `entity:${e.id}`,
      label: e.name,
      sub: `${ENTITY_TYPES[e.entity_type as EntityType] ?? e.entity_type} · ${e.jurisdiction}`,
      kind: "entity",
      href: `/families/${familyId}/organisation/${e.id}?tab=organogram`,
    });
  }
  const holderNode = (h: Holder) => {
    const key = holderKey(h);
    if (!nodes.has(key)) {
      nodes.set(key, {
        key,
        label: nameOf(h),
        sub:
          h.kind === "person"
            ? "Person"
            : h.kind === "organisation"
              ? "Service provider"
              : "Entity",
        kind: h.kind,
        // Only a link to someone this person may open.
        href:
          h.kind === "person" && (!visiblePeople || visiblePeople.has(h.id))
            ? `/families/${familyId}/tree/${h.id}`
            : undefined,
      });
    }
    return key;
  };
  for (const g of data.graph) {
    for (const s of g.shareholders)
      edges.push({
        from: holderNode(s.holder),
        to: `entity:${g.id}`,
        label: round(s.percent),
      });
  }
  for (const s of data.settlements) {
    const h = holderFrom(s);
    if (!h) continue;
    const to = `entity:${s.entity_id}`;
    const from = holderNode(h);
    const label =
      data.entities.find((e) => e.id === s.entity_id)?.entity_type ===
      "foundation"
        ? "Founder"
        : "Settlor";
    if (!edges.some((e) => e.from === from && e.to === to && e.label === label))
      edges.push({ from, to, label, dashed: true });
  }
  for (const a of data.appointments.filter(
    (x) =>
      x.holder_entity_id &&
      !x.ceased_on &&
      ["trustee", "council_member", "general_partner"].includes(x.role),
  )) {
    edges.push({
      from: `entity:${a.holder_entity_id}`,
      to: `entity:${a.entity_id}`,
      label:
        a.role === "trustee"
          ? "Trustee"
          : a.role === "council_member"
            ? "Council"
            : "General partner",
      dashed: true,
    });
  }
  return { nodes: [...nodes.values()], edges };
}

export function StructureChart({
  nodes,
  edges,
  focus,
  title,
}: {
  nodes: ChartNode[];
  edges: ChartEdge[];
  focus?: string;
  title: string;
}) {
  const part = connected(nodes, edges, focus);
  const chart = layout(part.nodes, part.edges);
  if (chart.nodes.length === 0)
    return <p className="text-ink-3">Nothing to show yet.</p>;
  const pad = 8;
  const label = (n: ChartNode) =>
    part.nodes.find((x) => x.key === n.key)?.label ?? "";
  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-border bg-background p-3 print:overflow-visible">
        <svg
          role="group"
          aria-labelledby="chart-title"
          width={chart.width + pad * 2}
          height={chart.height + pad * 2}
          viewBox={`${-pad} ${-pad} ${chart.width + pad * 2} ${chart.height + pad * 2}`}
          className="block max-w-none"
        >
          <title id="chart-title">{title}</title>
          <desc>The same information is listed in words below the chart.</desc>
          {chart.edges.map((e, i) => {
            const midY = (e.y1 + e.y2) / 2;
            const d = `M ${e.x1} ${e.y1} C ${e.x1} ${midY}, ${e.x2} ${midY}, ${e.x2} ${e.y2}`;
            const lx = (e.x1 + e.x2) / 2;
            return (
              <g key={i}>
                <path
                  d={d}
                  fill="none"
                  stroke="var(--color-ink-3, #6b6259)"
                  strokeWidth={1.5}
                  strokeDasharray={e.dashed ? "5 4" : undefined}
                  markerEnd="url(#arrow)"
                />
                <rect
                  x={lx - (e.label.length * 7 + 20) / 2}
                  y={midY - 11}
                  width={e.label.length * 7 + 20}
                  height={22}
                  rx={11}
                  fill="var(--color-card, #f2ece3)"
                  stroke="var(--color-border, #e3d8c9)"
                />
                <text
                  x={lx}
                  y={midY + 4}
                  textAnchor="middle"
                  fontSize={12}
                  fill="currentColor"
                  className="text-ink"
                >
                  {e.label}
                </text>
              </g>
            );
          })}
          <defs>
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path
                d="M 0 0 L 10 5 L 0 10 z"
                fill="var(--color-ink-3, #6b6259)"
              />
            </marker>
          </defs>
          {chart.nodes.map((n) => {
            const isFocus = n.key === focus;
            const box = (
              <g key={n.key}>
                <rect
                  x={n.x}
                  y={n.y}
                  width={BOX_W}
                  height={BOX_H}
                  rx={10}
                  fill={
                    n.kind === "entity"
                      ? "var(--color-card, #f2ece3)"
                      : "#ffffff"
                  }
                  stroke={
                    isFocus
                      ? "var(--color-primary, #e8553a)"
                      : "var(--color-border, #e3d8c9)"
                  }
                  strokeWidth={isFocus ? 3 : 1.5}
                />
                <text
                  x={n.x + 12}
                  y={n.y + 24}
                  fontSize={14}
                  fontWeight={600}
                  fill="currentColor"
                  className="text-ink"
                >
                  {short(n.label)}
                </text>
                <text
                  x={n.x + 12}
                  y={n.y + 43}
                  fontSize={12}
                  fill="currentColor"
                  className="text-ink-3"
                >
                  {short(n.sub, 32)}
                </text>
              </g>
            );
            return n.href ? (
              <a key={n.key} href={n.href} aria-label={label(n)}>
                {box}
              </a>
            ) : (
              box
            );
          })}
        </svg>
      </div>
      {/* The same information in words, for screen readers and printing. */}
      <div className="mt-3">
        <h3 className="text-sm font-semibold text-ink">The chart in words</h3>
        <ul className="mt-1 space-y-1 text-sm text-ink">
          {chart.edges.map((e, i) => {
            const from = part.nodes.find((n) => n.key === e.from);
            const to = part.nodes.find((n) => n.key === e.to);
            if (!from || !to) return null;
            const linkTo = to?.href ? (
              <Link
                href={to.href}
                className="underline decoration-border underline-offset-4"
              >
                {to.label}
              </Link>
            ) : (
              to?.label
            );
            return (
              <li key={i}>
                {from?.label} → {linkTo}:{" "}
                {/%$/.test(e.label)
                  ? `holds ${e.label}`
                  : e.label.toLowerCase()}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
