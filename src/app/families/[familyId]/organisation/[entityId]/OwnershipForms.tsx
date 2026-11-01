"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/feedback";

const label = "mb-1 block text-sm font-medium text-ink";

export type HolderOptions = {
  people: [string, string][];
  entities: [string, string][];
  organisations: [string, string][];
};

const ORG_KINDS: [string, string][] = [
  ["company", "Company"],
  ["trust_company", "Trust company"],
  ["corporate_services", "Corporate services provider"],
  ["registered_agent", "Registered agent"],
  ["bank", "Bank"],
  ["other", "Other"],
];

// Choose who: a person in the Tree, one of the family's entities, an outside
// organisation already recorded, or a new outside organisation (its fields
// only show when chosen). Extra options (e.g. a charitable cause) come first.
export function HolderSelect({
  name,
  idPrefix = name,
  title,
  options,
  extra = [],
  onChange,
}: {
  name: string;
  idPrefix?: string; // keeps ids unique when two such forms are on one page
  title: string;
  options: HolderOptions;
  extra?: [string, string][];
  onChange?: (value: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <div className="space-y-4 sm:col-span-2">
      <div className="max-w-md">
        <label htmlFor={idPrefix} className={label}>
          {title} (required)
        </label>
        <select
          id={idPrefix}
          name={name}
          required
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            onChange?.(e.target.value);
          }}
          className="text-input"
        >
          <option value="">Choose…</option>
          {extra.map(([v, t]) => (
            <option key={v} value={v}>
              {t}
            </option>
          ))}
          {options.people.length > 0 && (
            <optgroup label="People in the Tree">
              {options.people.map(([id, n]) => (
                <option key={id} value={`person:${id}`}>
                  {n}
                </option>
              ))}
            </optgroup>
          )}
          {options.entities.length > 0 && (
            <optgroup label="The family's entities">
              {options.entities.map(([id, n]) => (
                <option key={id} value={`entity:${id}`}>
                  {n}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Outside organisations">
            {options.organisations.map(([id, n]) => (
              <option key={id} value={`organisation:${id}`}>
                {n}
              </option>
            ))}
            <option value="new">A new outside organisation…</option>
          </optgroup>
        </select>
        <p className="mt-1 text-xs text-ink-3">A person outside the family is added to the Tree first, as non-family.</p>
      </div>
      {value === "new" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor={`${idPrefix}_new_name`} className={label}>
              Organisation&apos;s name (required)
            </label>
            <input id={`${idPrefix}_new_name`} name={`${name}_new_name`} required className="text-input" />
          </div>
          <div>
            <label htmlFor={`${idPrefix}_new_kind`} className={label}>
              Kind
            </label>
            <select id={`${idPrefix}_new_kind`} name={`${name}_new_kind`} className="text-input" defaultValue="company">
              {ORG_KINDS.map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${idPrefix}_new_jurisdiction`} className={label}>
              Jurisdiction
            </label>
            <input id={`${idPrefix}_new_jurisdiction`} name={`${name}_new_jurisdiction`} className="text-input" />
          </div>
          <div>
            <label htmlFor={`${idPrefix}_new_registration`} className={label}>
              Registration number
            </label>
            <input id={`${idPrefix}_new_registration`} name={`${name}_new_registration`} className="text-input" />
          </div>
        </div>
      )}
    </div>
  );
}

// Record a share transaction. Only the fields that apply to what happened
// are shown: authorising needs no holder; an issue needs who receives the
// shares; a transfer needs who gives them up as well.
export function ShareTransactionForm({
  action,
  classes,
  options,
  firstKind,
  units = "shares",
}: {
  action: (form: FormData) => Promise<void>;
  classes: [string, string][];
  options: HolderOptions;
  firstKind: "authorise" | "issue";
  units?: "shares" | "units";
}) {
  const [kind, setKind] = useState<string>(firstKind);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <form action={action} className="space-y-5">
      <fieldset>
        <legend className={label}>What happened</legend>
        <div className="flex flex-wrap gap-x-6">
          {(
            [
              ["authorise", `More ${units} authorised`],
              ["issue", `${units === "units" ? "Units" : "Shares"} issued`],
              ["transfer", `${units === "units" ? "Units" : "Shares"} transferred`],
            ] as const
          ).map(([v, t]) => (
            <label key={v} className="flex min-h-11 items-center gap-2 text-ink">
              <input type="radio" name="kind" value={v} checked={kind === v} onChange={() => setKind(v)} className="h-5 w-5" />
              {t}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label htmlFor="class_id" className={label}>
            Class (required)
          </label>
          <select id="class_id" name="class_id" required className="text-input">
            {classes.map(([id, n]) => (
              <option key={id} value={id}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="transaction_date" className={label}>
            Date (required)
          </label>
          <input id="transaction_date" name="transaction_date" type="date" required defaultValue={today} className="text-input" />
        </div>
        <div>
          <label htmlFor="shares" className={label}>
            Number of {units} (required)
          </label>
          <input id="shares" name="shares" inputMode="numeric" required className="text-input" />
        </div>
      </div>
      {kind === "transfer" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <HolderSelect name="from" title="From (the transferor)" options={options} />
        </div>
      )}
      {kind !== "authorise" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <HolderSelect name="to" title={kind === "issue" ? "Issued to" : "To (the transferee)"} options={options} />
        </div>
      )}
      {kind !== "authorise" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label htmlFor="certificate_number" className={label}>
              {kind === "issue" ? "Certificate number" : "New certificate number"}
            </label>
            <input id="certificate_number" name="certificate_number" className="text-input" />
          </div>
          {kind === "transfer" && (
            <div>
              <label htmlFor="balance_certificate_number" className={label}>
                Balance certificate number
              </label>
              <input id="balance_certificate_number" name="balance_certificate_number" className="text-input" />
              <p className="mt-1 text-xs text-ink-3">For the shares the transferor keeps. Their old certificates are cancelled.</p>
            </div>
          )}
          <div>
            <label htmlFor="consideration" className={label}>
              Amount paid
            </label>
            <input id="consideration" name="consideration" inputMode="decimal" className="text-input" />
            <p className="mt-1 text-xs text-ink-3">In the currency of the class.</p>
          </div>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="tx_resolution" className={label}>
            Approved by (minute or resolution)
          </label>
          <input id="tx_resolution" name="resolution" className="text-input" placeholder="e.g. Directors' resolution of 1 March 2026" />
        </div>
        <div>
          <label htmlFor="tx_notes" className={label}>
            Notes
          </label>
          <input id="tx_notes" name="notes" className="text-input" />
        </div>
      </div>
      <SubmitButton pendingText="Recording…">Record as a draft</SubmitButton>
    </form>
  );
}

// Add a beneficiary: a person, organisation, family entity, or a charitable
// cause (then only the description is asked for).
export function BeneficiaryForm({ action, options, interests }: { action: (form: FormData) => Promise<void>; options: HolderOptions; interests: [string, string][] }) {
  const [holder, setHolder] = useState("");
  return (
    <form action={action} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <HolderSelect name="holder" idPrefix="beneficiary" title="Beneficiary" options={options} extra={[["cause", "A charitable cause"]]} onChange={setHolder} />
      </div>
      {holder === "cause" && (
        <div className="max-w-md">
          <label htmlFor="cause" className={label}>
            The cause (required)
          </label>
          <input id="cause" name="cause" required className="text-input" placeholder="e.g. Education in rural communities" />
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label htmlFor="interest" className={label}>
            Interest
          </label>
          <select id="interest" name="interest" className="text-input" defaultValue="discretionary">
            {interests.map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="share_percent" className={label}>
            Fixed share (%)
          </label>
          <input id="share_percent" name="share_percent" inputMode="decimal" className="text-input" />
        </div>
        <div>
          <label htmlFor="beneficiary_added_on" className={label}>
            Beneficiary since
          </label>
          <input id="beneficiary_added_on" name="added_on" type="date" className="text-input" />
        </div>
      </div>
      <SubmitButton pendingText="Adding…">Add beneficiary</SubmitButton>
    </form>
  );
}

// Record a settlement (or the founder's endowment of a foundation).
export function SettlementForm({ action, options, foundation, currency }: { action: (form: FormData) => Promise<void>; options: HolderOptions; foundation: boolean; currency: string | null }) {
  return (
    <form action={action} className="space-y-5">
      <fieldset>
        <legend className={label}>Kind</legend>
        <div className="flex flex-wrap gap-x-6">
          <label className="flex min-h-11 items-center gap-2 text-ink">
            <input type="radio" name="kind" value="initial" defaultChecked className="h-5 w-5" />
            {foundation ? "The founder's endowment" : "The first settlement"}
          </label>
          <label className="flex min-h-11 items-center gap-2 text-ink">
            <input type="radio" name="kind" value="additional" className="h-5 w-5" />
            An addition to the capital
          </label>
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <HolderSelect name="holder" idPrefix="settlor" title={foundation ? "Founder or contributor" : "Settlor"} options={options} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <label htmlFor="settlement_description" className={label}>
            What was given
          </label>
          <input id="settlement_description" name="description" className="text-input" placeholder="e.g. Cash, or shares in Hartley Holdings Ltd" />
        </div>
        <div>
          <label htmlFor="settlement_amount" className={label}>
            Value
          </label>
          <input id="settlement_amount" name="amount" inputMode="decimal" className="text-input" />
        </div>
        <div>
          <label htmlFor="settlement_currency" className={label}>
            Currency
          </label>
          <input id="settlement_currency" name="currency" defaultValue={currency ?? ""} maxLength={3} className="text-input uppercase" />
        </div>
        <div>
          <label htmlFor="settled_on" className={label}>
            Date
          </label>
          <input id="settled_on" name="settled_on" type="date" className="text-input" />
        </div>
      </div>
      <SubmitButton pendingText="Recording…">Record</SubmitButton>
    </form>
  );
}
