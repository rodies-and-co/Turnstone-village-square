"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

// Feedback for every button press: the button shows it is working straight
// away, and a message confirms what happened when the page comes back.

function Spinner() {
  return (
    <svg aria-hidden="true" className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// A form's submit button. While the form is being saved it is disabled and
// says what is happening, e.g. "Saving…".
export function SubmitButton({
  children,
  pendingText = "Saving…",
  variant = "primary",
  ariaLabel,
}: {
  children: ReactNode;
  pendingText?: string;
  variant?: "primary" | "secondary";
  ariaLabel?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      aria-label={pending ? undefined : ariaLabel}
      className={variant === "primary" ? "btn-primary" : "btn-secondary"}
    >
      {pending && <Spinner />}
      {pending ? pendingText : children}
    </button>
  );
}

// "Remove" asks once before removing, because removing can't be undone here.
// Keyboard focus moves to "Keep" when it asks, and back to "Remove" if kept.
export function ConfirmRemove({
  action,
  what,
  label = "Remove",
}: {
  action: () => Promise<void>;
  what: string;
  label?: string;
}) {
  const [asking, setAsking] = useState(false);
  const [moved, setMoved] = useState(false);
  const removeRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!moved) return;
    (asking ? keepRef : removeRef).current?.focus();
  }, [asking, moved]);

  if (!asking) {
    return (
      <button
        ref={removeRef}
        type="button"
        className="btn-secondary"
        aria-label={`${label} ${what}`}
        onClick={() => {
          setMoved(true);
          setAsking(true);
        }}
      >
        {label}
      </button>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-center gap-2" role="group" aria-label={`Confirm: ${label.toLowerCase()} ${what}`}>
      <span className="text-sm font-medium text-ink">
        {label} {what}?
      </span>
      <SubmitButton variant="primary" pendingText="Removing…">
        Yes, {label.toLowerCase()}
      </SubmitButton>
      <button ref={keepRef} type="button" className="btn-secondary" onClick={() => setAsking(false)}>
        Keep
      </button>
    </form>
  );
}

// The confirmation message shown after the page comes back. It stays for a
// few seconds (errors stay until closed), and is read out by screen readers.
export function Toast({ message, kind = "success" }: { message: string; kind?: "success" | "error" }) {
  const [open, setOpen] = useState(true);
  // The message area appears empty first and the words are added a moment
  // later, so screen readers notice the change and read it out.
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const show = setTimeout(() => setShown(true), 100);
    // Tidy the address bar, so refreshing the page doesn't show it again.
    const url = new URL(window.location.href);
    for (const k of ["saved", "error", "removed"]) url.searchParams.delete(k);
    window.history.replaceState(window.history.state, "", url.toString());
    const hide = kind === "success" ? setTimeout(() => setOpen(false), 6000) : undefined;
    return () => {
      clearTimeout(show);
      if (hide) clearTimeout(hide);
    };
  }, [kind]);

  if (!open) return null;
  return (
    <div role={kind === "error" ? "alert" : "status"} aria-live={kind === "error" ? "assertive" : "polite"}>
      {shown && (
        <div
          className={`toast fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md items-center gap-3 rounded-xl border-2 px-4 py-3 shadow-lg sm:inset-x-auto sm:right-6 sm:bottom-6 ${
            kind === "error" ? "border-primary bg-card" : "border-ink bg-card"
          }`}
        >
          <span
            aria-hidden="true"
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-bold ${kind === "error" ? "bg-primary text-ink" : "bg-ink text-card"}`}
          >
            {kind === "error" ? "!" : "✓"}
          </span>
          <p className="grow font-medium text-ink">
            <span className="sr-only">{kind === "error" ? "Not saved: " : "Done: "}</span>
            {message}
          </p>
          <button type="button" onClick={() => setOpen(false)} className="btn-secondary" aria-label="Close message">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
