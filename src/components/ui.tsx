import Link from "next/link";
import type { ReactNode } from "react";

// Small building blocks used across the family pages.

export function PageShell({ children }: { children: ReactNode }) {
  return <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>;
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <p>
      <Link href={href} className="inline-flex min-h-11 items-center underline">
        {children}
      </Link>
    </p>
  );
}

// A beige panel with a heading, as in The Family Square.
export function Card({
  title,
  description,
  children,
  actions,
}: {
  title?: string;
  description?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5 sm:p-6">
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-xl font-semibold text-ink">{title}</h2>}
            {description && <p className="mt-1 text-sm text-ink-2">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

// A list with lines between rows, as in The Family Register.
export function Rows({ children }: { children: ReactNode }) {
  return <ul className="divide-y divide-border border-y border-border">{children}</ul>;
}

export function Row({ title, meta, children }: { title: ReactNode; meta?: ReactNode; children?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3">
      <div className="min-w-0">
        <div className="text-[15px] font-medium text-ink">{title}</div>
        {meta && <div className="text-sm text-ink-3">{meta}</div>}
      </div>
      {children && <div className="flex items-center gap-1">{children}</div>}
    </li>
  );
}

// A fold-out such as "▸ Add a parent": closed until clicked, so each small
// form only appears when it is wanted.
export function Fold({ label, children, danger, open }: { label: string; children: ReactNode; danger?: boolean; open?: boolean }) {
  return (
    <details className={`fold mt-2 ${danger ? "fold-danger" : ""}`} open={open}>
      <summary>{label}</summary>
      <div className="mt-2 rounded-lg border border-border bg-background p-4">{children}</div>
    </details>
  );
}

export function Alert({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="alert">
      {children}
    </p>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-border bg-card px-4 py-3 text-ink-2">{children}</p>;
}

export function Field({
  label,
  name,
  defaultValue,
  type = "text",
  required,
  hint,
  disabled,
}: {
  label: string;
  name: string;
  defaultValue?: string | number | null;
  type?: string;
  required?: boolean;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <div>
      <label htmlFor={name} className="mb-1 block text-sm font-medium text-ink">
        {label}
        {required ? " (required)" : ""}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue ?? ""}
        required={required}
        disabled={disabled}
        className="text-input disabled:opacity-60"
      />
      {hint && <p className="mt-1 text-xs text-ink-3">{hint}</p>}
    </div>
  );
}

export function Select({
  label,
  name,
  options,
  defaultValue,
  includeBlank,
  required,
  disabled,
  hint,
}: {
  label: string;
  name: string;
  options: Record<string, string> | [string, string][];
  defaultValue?: string | null;
  includeBlank?: string;
  required?: boolean;
  disabled?: boolean;
  hint?: string;
}) {
  const entries = Array.isArray(options) ? options : Object.entries(options);
  return (
    <div>
      <label htmlFor={name} className="mb-1 block text-sm font-medium text-ink">
        {label}
        {required ? " (required)" : ""}
      </label>
      <select
        id={name}
        name={name}
        defaultValue={defaultValue ?? ""}
        required={required}
        disabled={disabled}
        className="text-input disabled:opacity-60"
      >
        {includeBlank !== undefined && <option value="">{includeBlank}</option>}
        {entries.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
      {hint && <p className="mt-1 text-xs text-ink-3">{hint}</p>}
    </div>
  );
}

export function Checkbox({ label, name, defaultChecked }: { label: string; name: string; defaultChecked?: boolean }) {
  return (
    <label className="flex min-h-11 items-center gap-3 text-ink">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="h-5 w-5" />
      {label}
    </label>
  );
}

export function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-sm text-ink-3">{k}</dt>
          <dd className="font-medium text-ink">{v || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

// A small label, e.g. "Family leader". Text always carries the meaning.
export function Chip({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center rounded-full bg-bronze px-2.5 py-0.5 text-xs font-medium text-ink">{children}</span>;
}

// A person's initials in a circle, e.g. "HV". Decorative: the name is always
// written next to it.
export function Initials({ name, size = "md", strong }: { name: string; size?: "md" | "lg"; strong?: boolean }) {
  const letters = name
    .replace(/\(.*?\)/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .filter((c) => /[A-Za-zÀ-ÿ]/.test(c));
  const text = (letters[0] ?? "") + (letters.length > 1 ? letters[letters.length - 1] : "");
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-full font-bold text-ink ${strong ? "bg-bronze" : "bg-muted"} ${
        size === "lg" ? "h-16 w-16 text-xl" : "h-9 w-9 text-sm"
      }`}
    >
      {text.toUpperCase()}
    </span>
  );
}

// Tabs underlined in Turnstone orange, as in The Family Square. One line;
// scrolls sideways on a small screen instead of wrapping.
export function UnderlineTabs({ label, items, current }: { label: string; items: [key: string, text: string, href: string][]; current: string }) {
  return (
    <nav aria-label={label} className="border-b border-border">
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {items.map(([key, text, href]) => {
          const active = key === current;
          return (
            <li key={key} className="shrink-0">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-11 items-center whitespace-nowrap border-b-4 px-3 text-ink ${
                  active ? "border-primary font-semibold" : "border-transparent font-medium hover:border-bronze"
                }`}
              >
                {text}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
