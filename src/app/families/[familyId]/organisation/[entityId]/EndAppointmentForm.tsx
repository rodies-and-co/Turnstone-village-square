"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/feedback";

const label = "mb-1 block text-sm font-medium text-ink";

// Ending an appointment:
//   - Resigned: it ends on the date of the resignation, and the resignation
//     is noted in a meeting or written resolution;
//   - Removed: the removal is drafted as a decision, and it ends once passed;
//   - Another reason (e.g. died, term ended): it ends on the date given.
export function EndAppointmentForm({
  action,
  what,
  since,
  targets,
  idPrefix,
}: {
  action: (form: FormData) => Promise<void>;
  what: string;
  since: string | null;
  targets: [string, string][];
  idPrefix: string;
}) {
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Europe/London",
  });
  const [reason, setReason] = useState<"resigned" | "removed" | "other">(
    "resigned",
  );
  return (
    <form action={action} className="space-y-4">
      <fieldset>
        <legend className={label}>Why is {what} ending?</legend>
        <div className="flex flex-wrap gap-x-6">
          {(
            [
              ["resigned", "Resigned"],
              ["removed", "Removed by decision"],
              ["other", "Another reason (e.g. died, term ended)"],
            ] as const
          ).map(([v, t]) => (
            <label
              key={v}
              className="flex min-h-11 items-center gap-2 text-ink"
            >
              <input
                type="radio"
                name="reason"
                value={v}
                checked={reason === v}
                onChange={() => setReason(v)}
                className="h-5 w-5"
              />
              {t}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${idPrefix}-date`} className={label}>
            {reason === "resigned"
              ? "Date of the resignation"
              : reason === "removed"
                ? "Removed with effect from"
                : "Date it ended"}
          </label>
          <input
            id={`${idPrefix}-date`}
            name="ended_on"
            type="date"
            required
            defaultValue={today}
            min={since ?? undefined}
            max={reason === "removed" ? undefined : today}
            className="text-input"
          />
          {reason === "removed" && (
            <p className="mt-1 text-xs text-ink-3">
              Or later: it never ends before the decision passes.
            </p>
          )}
        </div>
        {reason !== "other" && (
          <div>
            <label htmlFor={`${idPrefix}-in`} className={label}>
              {reason === "resigned"
                ? "Note the resignation in"
                : "Decide the removal in"}
            </label>
            <select
              id={`${idPrefix}-in`}
              name="note_in"
              required
              className="text-input"
              defaultValue=""
            >
              <option value="" disabled>
                Choose…
              </option>
              {targets.map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-ink-3">
              {reason === "resigned"
                ? "It ends on the date of the resignation. The wording (“The board noted the resignation of …”) is added for you."
                : "The wording is drafted for you. The appointment ends once the meeting is confirmed or the resolution passes. Check the articles: in many places (the UK, for example) a director is removed by the members at a meeting, not by the board."}
            </p>
          </div>
        )}
      </div>
      <SubmitButton pendingText="Saving…">
        {reason === "removed" ? "Draft the removal" : "End the appointment"}
      </SubmitButton>
    </form>
  );
}
