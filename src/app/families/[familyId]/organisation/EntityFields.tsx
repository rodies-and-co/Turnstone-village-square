"use client";

import { useState } from "react";
import { ENTITY_TYPES } from "@/lib/entity-checklist";
import { MONTHS } from "@/lib/people";

type Option = { jurisdiction: string; entity_type: string; sub_type: string; status: string };
export type EntityValues = {
  name?: string;
  entity_type?: string;
  jurisdiction?: string;
  sub_type?: string;
  registration_number?: string | null;
  registered_on?: string | null;
  activity?: string | null;
  year_end_month?: number | null;
  year_end_day?: number | null;
  base_currency?: string | null;
  family_contact_id?: string | null;
  branch_id?: string | null;
  status?: string;
  dissolved_on?: string | null;
};

const OTHER = "__other__";
const label = "mb-1 block text-sm font-medium text-ink";
const hint = "mt-1 text-xs text-ink-3";

// The fields of an entity. Choosing the jurisdiction and type offers the
// sub-types that have an Entity Standard; "Other" lets you type a new one,
// for which a draft standard is created for review.
export function EntityFields({
  values = {},
  standards,
  people,
  branches,
  lockKind,
}: {
  values?: EntityValues;
  standards: Option[];
  people: [string, string][];
  branches: [string, string][];
  lockKind?: boolean;
}) {
  const jurisdictions = [...new Set(standards.map((s) => s.jurisdiction))].sort();
  const known = (j: string) => jurisdictions.includes(j);
  const [type, setType] = useState(values.entity_type ?? "company");
  const [status, setStatus] = useState(values.status ?? "active");
  const [jur, setJur] = useState(values.jurisdiction ? (known(values.jurisdiction) ? values.jurisdiction : OTHER) : "");
  const [jurText, setJurText] = useState(values.jurisdiction && !known(values.jurisdiction) ? values.jurisdiction : "");
  const jurisdiction = jur === OTHER ? jurText : jur;
  const subTypes = [...new Set(standards.filter((s) => s.jurisdiction === jurisdiction && s.entity_type === type && s.status !== "retired").map((s) => s.sub_type))];
  const [sub, setSub] = useState(values.sub_type ?? "");
  const subIsKnown = subTypes.includes(sub);
  const [subChoice, setSubChoice] = useState(values.sub_type ? (subIsKnown ? values.sub_type : OTHER) : "");
  const subValue = subChoice === OTHER || subTypes.length === 0 ? sub : subChoice;

  return (
    <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
      <div className="sm:col-span-2 lg:col-span-1">
        <label htmlFor="name" className={label}>
          Name (required)
        </label>
        <input id="name" name="name" required defaultValue={values.name} className="text-input" />
      </div>

      <div>
        <label htmlFor="entity_type" className={label}>
          Kind of entity (required)
        </label>
        <select
          id="entity_type"
          name="entity_type"
          value={type}
          disabled={lockKind}
          onChange={(e) => {
            setType(e.target.value);
            setSubChoice("");
          }}
          className="text-input"
        >
          {Object.entries(ENTITY_TYPES).map(([v, t]) => (
            <option key={v} value={v}>
              {t}
            </option>
          ))}
        </select>
        {lockKind && <input type="hidden" name="entity_type" value={type} />}
      </div>

      <div>
        <label htmlFor="jurisdiction_choice" className={label}>
          Jurisdiction (required)
        </label>
        <select
          id="jurisdiction_choice"
          value={jur}
          disabled={lockKind}
          onChange={(e) => {
            setJur(e.target.value);
            setSubChoice("");
          }}
          className="text-input"
          required
        >
          <option value="">Choose…</option>
          {jurisdictions.map((j) => (
            <option key={j} value={j}>
              {j}
            </option>
          ))}
          <option value={OTHER}>Another jurisdiction…</option>
        </select>
        {jur === OTHER && !lockKind && (
          <input aria-label="Jurisdiction name" value={jurText} onChange={(e) => setJurText(e.target.value)} placeholder="e.g. Jersey" className="text-input mt-2" required />
        )}
        <input type="hidden" name="jurisdiction" value={jurisdiction} />
      </div>

      <div className="sm:col-span-2 lg:col-span-1">
        <label htmlFor="sub_type_choice" className={label}>
          Type (required)
        </label>
        {subTypes.length > 0 && !lockKind ? (
          <select id="sub_type_choice" value={subChoice} onChange={(e) => setSubChoice(e.target.value)} className="text-input" required>
            <option value="">Choose…</option>
            {subTypes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
            <option value={OTHER}>Another type…</option>
          </select>
        ) : null}
        {(subChoice === OTHER || subTypes.length === 0 || lockKind) && (
          <input
            id={subTypes.length && !lockKind ? undefined : "sub_type_choice"}
            aria-label="Type of entity"
            value={sub}
            disabled={lockKind}
            onChange={(e) => setSub(e.target.value)}
            placeholder="e.g. Private company limited by shares"
            className={`text-input ${subTypes.length && !lockKind ? "mt-2" : ""}`}
            required
          />
        )}
        <input type="hidden" name="sub_type" value={subValue} />
        {!lockKind && jurisdiction && (subChoice === OTHER || subTypes.length === 0) && (
          <p className={hint}>There is no Entity Standard for this yet. A draft is created for the Super User or System Admin to review.</p>
        )}
        {lockKind && <p className={hint}>The jurisdiction and type decide the Entity Standard, so they can&apos;t be changed here.</p>}
      </div>

      <div>
        <label htmlFor="registration_number" className={label}>
          Registration number
        </label>
        <input id="registration_number" name="registration_number" defaultValue={values.registration_number ?? ""} className="text-input" />
      </div>
      <div>
        <label htmlFor="registered_on" className={label}>
          Date registered or established
        </label>
        <input id="registered_on" name="registered_on" type="date" defaultValue={values.registered_on ?? ""} className="text-input" />
      </div>

      <fieldset className="sm:col-span-2 lg:col-span-1">
        <legend className={label}>Financial year end</legend>
        <div className="grid grid-cols-[5rem_1fr] gap-2">
          <select aria-label="Year end day" name="year_end_day" defaultValue={values.year_end_day ?? ""} className="text-input">
            <option value="">—</option>
            {Array.from({ length: 31 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <select aria-label="Year end month" name="year_end_month" defaultValue={values.year_end_month ?? ""} className="text-input">
            <option value="">—</option>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </fieldset>
      <div>
        <label htmlFor="base_currency" className={label}>
          Base currency
        </label>
        <input
          id="base_currency"
          name="base_currency"
          list="currencies"
          maxLength={3}
          defaultValue={values.base_currency ?? ""}
          placeholder="e.g. GBP"
          className="text-input uppercase"
        />
        <datalist id="currencies">
          {["GBP", "USD", "EUR", "ZAR", "MUR", "CHF"].map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <p className={hint}>For a company, the currency of its shares.</p>
      </div>
      <div>
        <label htmlFor="status" className={label}>
          Status
        </label>
        <select id="status" name="status" value={status} onChange={(e) => setStatus(e.target.value)} className="text-input">
          <option value="active">Active</option>
          <option value="dormant">Dormant</option>
          <option value="dissolved">Dissolved</option>
        </select>
        {status === "dissolved" && lockKind && (
          <div className="mt-2">
            <label htmlFor="dissolved_on" className={label}>
              Date dissolved
            </label>
            <input id="dissolved_on" name="dissolved_on" type="date" defaultValue={values.dissolved_on ?? ""} className="text-input" />
          </div>
        )}
      </div>

      <div>
        <label htmlFor="family_contact_id" className={label}>
          Family contact
        </label>
        <select id="family_contact_id" name="family_contact_id" defaultValue={values.family_contact_id ?? ""} className="text-input">
          <option value="">Not recorded</option>
          {people.map(([id, n]) => (
            <option key={id} value={id}>
              {n}
            </option>
          ))}
        </select>
        <p className={hint}>Who in the family liaises with the officers.</p>
      </div>
      <div>
        <label htmlFor="branch_id" className={label}>
          Belongs to
        </label>
        <select id="branch_id" name="branch_id" defaultValue={values.branch_id ?? ""} className="text-input">
          <option value="">The whole family</option>
          {branches.map(([id, n]) => (
            <option key={id} value={id}>
              {n}
            </option>
          ))}
        </select>
        <p className={hint}>Viewers with access to that branch can see it.</p>
      </div>
      <div className="sm:col-span-2 lg:col-span-3">
        <label htmlFor="activity" className={label}>
          Activity
        </label>
        <textarea id="activity" name="activity" rows={2} defaultValue={values.activity ?? ""} className="text-area" />
      </div>
    </div>
  );
}
