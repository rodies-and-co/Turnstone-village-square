"use client";

import { useState } from "react";
import { ENTITY_TYPES, matchStandard } from "@/lib/entity-checklist";
import { REQUIRED_APPOINTEES, type RequiredAppointee } from "@/lib/providers";
import { NewProviderFields } from "./ProviderFields";
import { MONTHS } from "@/lib/people";

type Option = {
  jurisdiction: string;
  entity_type: string;
  sub_type: string;
  status: string;
  version?: number;
  registered_agent_required?: boolean;
  management_company_required?: boolean;
  licensed_trustee_required?: boolean;
};
export type EntityValues = {
  name?: string;
  entity_type?: string;
  jurisdiction?: string;
  sub_type?: string;
  registration_number?: string | null;
  registered_on?: string | null;
  compliance_from?: string | null;
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
  providers = [],
  familyEntities = [],
}: {
  values?: EntityValues;
  standards: Option[];
  people: [string, string][];
  branches: [string, string][];
  lockKind?: boolean;
  // For a new entity: who can be appointed straight away to the corporate
  // roles its Entity Standard requires.
  providers?: [id: string, name: string, licensed: boolean][];
  familyEntities?: [string, string][];
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
  const standard = !lockKind && jurisdiction && subValue ? matchStandard(standards.map((x) => ({ version: 1, ...x })), { jurisdiction, entity_type: type, sub_type: subValue }) : null;
  const required = standard ? REQUIRED_APPOINTEES.filter((r) => standard[r.flag]) : [];

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

      {lockKind && (
        <div>
          <label htmlFor="compliance_from" className={label}>
            Track filings from
          </label>
          <input id="compliance_from" name="compliance_from" type="date" defaultValue={values.compliance_from ?? ""} className="text-input" />
          <p className={hint}>Earlier periods aren&apos;t shown in the compliance calendar. Empty: 12 months before it was added here.</p>
        </div>
      )}

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
      {required.length > 0 && (
        <fieldset className="space-y-5 rounded-lg border border-border bg-card p-4 sm:col-span-2 lg:col-span-3">
          <legend className="px-1 font-semibold text-ink">Required from the start</legend>
          <p className="text-sm text-ink-2">The Entity Standard for {subValue} requires these from the start. They are recorded as appointments when the entity is saved.</p>
          {required.map((r) => (
            <AppointeeChoice key={r.role} need={r} providers={providers} familyEntities={familyEntities} />
          ))}
        </fieldset>
      )}
    </div>
  );
}

// Choose who holds a required corporate role: a service provider already
// recorded, one of the family's entities, or a new provider (its fields show
// only then).
function AppointeeChoice({
  need,
  providers,
  familyEntities,
}: {
  need: RequiredAppointee;
  providers: [string, string, boolean][];
  familyEntities: [string, string][];
}) {
  const [choice, setChoice] = useState("");
  const name = `appoint_${need.role}`;
  return (
    <div className="space-y-3">
      <div className="max-w-md">
        <label htmlFor={name} className={label}>
          {need.label} (required)
        </label>
        <select id={name} name={name} required value={choice} onChange={(e) => setChoice(e.target.value)} className="text-input">
          <option value="">Choose…</option>
          {providers.length > 0 && (
            <optgroup label="Service providers">
              {providers.map(([id, n, licensed]) => (
                <option key={id} value={`organisation:${id}`}>
                  {n}
                  {need.licensed ? (licensed ? " (licensed)" : " (not recorded as licensed)") : ""}
                </option>
              ))}
            </optgroup>
          )}
          {need.allowEntity && familyEntities.length > 0 && (
            <optgroup label="The family's entities">
              {familyEntities.map(([id, n]) => (
                <option key={id} value={`entity:${id}`}>
                  {n}
                </option>
              ))}
            </optgroup>
          )}
          <option value="new">A new service provider…</option>
        </select>
        <p className={hint}>{need.hint}</p>
      </div>
      {choice === "new" && <NewProviderFields prefix={`${name}_`} defaultKind={need.kind} requireLicence={need.licensed} />}
    </div>
  );
}
