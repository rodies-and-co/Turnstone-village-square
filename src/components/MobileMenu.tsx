"use client";

import { useState, type ReactNode } from "react";

// On a phone the side menu folds away behind a "Menu" button.
export function MobileMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="md:hidden">
      <button type="button" className="btn-secondary" aria-expanded={open} aria-controls="mobile-menu" onClick={() => setOpen(!open)}>
        {open ? "Close menu" : "Menu"}
      </button>
      {open && (
        <div id="mobile-menu" className="absolute inset-x-0 z-40 mt-3 border-b border-border bg-background px-4 pb-6 shadow-lg">
          {children}
        </div>
      )}
    </div>
  );
}
