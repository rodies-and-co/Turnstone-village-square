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

export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-6">
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          {title && <h2 className="text-lg font-semibold text-ink">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
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
  return <p className="rounded-lg bg-muted px-4 py-3 text-ink">{children}</p>;
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
      <label htmlFor={name} className="mb-1 block font-medium text-ink">
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
      {hint && <p className="mt-1 text-sm text-ink">{hint}</p>}
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
      <label htmlFor={name} className="mb-1 block font-medium text-ink">
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
      {hint && <p className="mt-1 text-sm text-ink">{hint}</p>}
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
          <dt className="text-sm text-ink">{k}</dt>
          <dd className="font-medium text-ink">{v || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
