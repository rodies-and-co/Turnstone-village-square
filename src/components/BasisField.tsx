// "Decided by": the passed minute or written resolution a share transaction
// or an appointment relies on, or the formation documents, or (for an
// appointment) a deed or letter of appointment. Used in server and client forms.

const label = "mb-1 block text-sm font-medium text-ink";

export function BasisField({
  decisions,
  instrument = false,
  idPrefix = "basis",
  defaultValue,
  defaultNote,
  hint,
}: {
  // From decisionChoices(): ["decision:<id>", "Board: Minute 3, item 1 – … (passed …)"].
  decisions: [string, string][];
  instrument?: boolean;
  idPrefix?: string;
  defaultValue?: string | null;
  defaultNote?: string | null;
  hint?: string;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={`${idPrefix}_choice`} className={label}>
          Decided by (required)
        </label>
        <select
          id={`${idPrefix}_choice`}
          name="basis_choice"
          defaultValue={defaultValue ?? ""}
          required
          className="text-input"
        >
          <option value="" disabled>
            Choose…
          </option>
          {decisions.length > 0 && (
            <optgroup label="Minutes and written resolutions">
              {decisions.map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Other">
            <option value="formation">
              The formation documents (constitution, deed or charter)
            </option>
            {instrument && (
              <option value="instrument">
                A deed or letter of appointment
              </option>
            )}
          </optgroup>
        </select>
        <p className="mt-1 text-xs text-ink-3">
          {hint ??
            (decisions.length
              ? "Record the meeting or resolution first (Decisions & file notes). It must be passed before this counts."
              : "No minutes or resolutions are recorded for this entity yet. Record the decision under Decisions & file notes first, unless it was part of the formation documents.")}
        </p>
      </div>
      {instrument && (
        <div>
          <label htmlFor={`${idPrefix}_note`} className={label}>
            Deed or letter of appointment
          </label>
          <input
            id={`${idPrefix}_note`}
            name="basis_note"
            defaultValue={defaultNote ?? ""}
            className="text-input"
          />
          <p className="mt-1 text-xs text-ink-3">
            Only if chosen above: its date and who signed it, e.g. &quot;Deed of
            appointment by the protector, 1 March 2026&quot;.
          </p>
        </div>
      )}
    </div>
  );
}
