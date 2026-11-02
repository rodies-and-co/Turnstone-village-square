"use client";

// Opens the browser's print window, which can also save the page as a PDF.
// The side menu, tabs and buttons are left off the printout.
export function PrintButton({ label = "Print or save as PDF" }: { label?: string }) {
  return (
    <button type="button" className="btn-secondary print:hidden" onClick={() => window.print()}>
      {label}
    </button>
  );
}
