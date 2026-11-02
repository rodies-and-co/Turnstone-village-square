"use client";

import type { ReactNode } from "react";

// A folding section of the side menu. Only one is open at a time: opening
// one closes the others. Browsers that group <details name="…"> do this
// themselves; the script below makes sure every browser does.
export function MenuSection({
  title,
  open,
  children,
}: {
  title: string;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      name="side-menu-areas"
      data-menu-section=""
      className="group"
      open={open || undefined}
      onToggle={(e) => {
        const me = e.currentTarget;
        if (!me.open) return;
        me.closest("nav")
          ?.querySelectorAll<HTMLDetailsElement>("details[data-menu-section]")
          .forEach((d) => {
            if (d !== me && d.open) d.open = false;
          });
      }}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-md px-1 font-semibold text-ink-2 hover:bg-muted [&::-webkit-details-marker]:hidden">
        {title}
        <span
          aria-hidden="true"
          className="text-sm transition-transform group-open:rotate-90"
        >
          ›
        </span>
      </summary>
      {children}
    </details>
  );
}
