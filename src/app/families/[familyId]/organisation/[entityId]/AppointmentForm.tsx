"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/feedback";
import { APPOINTMENT_ROLES, type AppointmentRole } from "@/lib/entity-checklist";
import { NewProviderFields } from "../ProviderFields";

const label = "mb-1 block text-sm font-medium text-ink";

// Appoint an officer: choose the role, then who holds it – a person in the
// Tree, a service provider (chosen from the family's list, or added here
// once), or one of the family's own entities. Only the fields that apply are
// shown.
export function AppointmentForm({
  action,
  roles,
  people,
  organisations,
  entities,
  jurisdiction,
}: {
  action: (form: FormData) => Promise<void>;
  roles: AppointmentRole[];
  people: [string, string][];
  organisations: [string, string][];
  entities: [string, string][];
  jurisdiction: string;
}) {
  const [role, setRole] = useState<string>(roles[0] ?? "director");
  const [holder, setHolder] = useState<"person" | "organisation" | "entity">("person");
  const [orgId, setOrgId] = useState("");
  const others = (Object.keys(APPOINTMENT_ROLES) as AppointmentRole[]).filter((r) => !roles.includes(r));
  const holders: [typeof holder, string][] = [
    ["person", "A person"],
    ["organisation", "A service provider"],
    ...(entities.length ? ([["entity", "One of the family's entities"]] as [typeof holder, string][]) : []),
  ];

  return (
    <form action={action} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label htmlFor="role" className={label}>
            Role (required)
          </label>
          <select id="role" name="role" value={role} onChange={(e) => setRole(e.target.value)} className="text-input">
            <optgroup label="Usual for this entity">
              {roles.map((r) => (
                <option key={r} value={r}>
                  {APPOINTMENT_ROLES[r]}
                </option>
              ))}
            </optgroup>
            <optgroup label="Other roles">
              {others.map((r) => (
                <option key={r} value={r}>
                  {APPOINTMENT_ROLES[r]}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
        <div>
          <label htmlFor="appointed_on" className={label}>
            Appointed on
          </label>
          <input id="appointed_on" name="appointed_on" type="date" className="text-input" />
        </div>
      </div>

      <fieldset>
        <legend className={label}>Held by</legend>
        <div className="flex flex-wrap gap-x-6">
          {holders.map(([h, text]) => (
            <label key={h} className="flex min-h-11 items-center gap-2 text-ink">
              <input type="radio" name="holder" value={h} checked={holder === h} onChange={() => setHolder(h)} className="h-5 w-5" />
              {text}
            </label>
          ))}
        </div>
      </fieldset>

      {holder === "person" && (
        <div className="max-w-md">
          <label htmlFor="person_id" className={label}>
            Person (required)
          </label>
          <select id="person_id" name="person_id" required className="text-input" defaultValue="">
            <option value="">Choose…</option>
            {people.map(([id, n]) => (
              <option key={id} value={id}>
                {n}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-ink-3">Anyone outside the family is added to the Tree first, as non-family.</p>
        </div>
      )}

      {holder === "organisation" && (
        <div className="space-y-4">
          <div className="max-w-md">
            <label htmlFor="organisation_id" className={label}>
              Service provider (required)
            </label>
            <select id="organisation_id" name="organisation_id" value={orgId} onChange={(e) => setOrgId(e.target.value)} className="text-input">
              <option value="">A new service provider (fill in below)</option>
              {organisations.map(([id, n]) => (
                <option key={id} value={id}>
                  {n}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-ink-3">Each provider is recorded once and kept up to date on the Service providers page.</p>
          </div>
          {!orgId && (
            <NewProviderFields
              prefix="organisation_"
              defaultKind={role === "registered_agent" ? "registered_agent" : role === "trustee" ? "trust_company" : role === "management_company" ? "management_company" : role === "auditor" ? "accounting_firm" : "corporate_services"}
            />
          )}
        </div>
      )}

      {holder === "entity" && (
        <div className="max-w-md">
          <label htmlFor="holder_entity_id" className={label}>
            Family entity (required)
          </label>
          <select id="holder_entity_id" name="holder_entity_id" required className="text-input" defaultValue="">
            <option value="">Choose…</option>
            {entities.map(([id, n]) => (
              <option key={id} value={id}>
                {n}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-ink-3">For example the family&apos;s private trust company as trustee, or a family company as corporate director.</p>
        </div>
      )}

      <fieldset className="flex flex-wrap gap-x-6">
        <legend className="sr-only">About this appointment</legend>
        <label className="flex min-h-11 items-center gap-2 text-ink">
          <input type="checkbox" name="resident" className="h-5 w-5" />
          Resident in {jurisdiction}
        </label>
        {holder === "person" && (
          <label className="flex min-h-11 items-center gap-2 text-ink">
            <input type="checkbox" name="identity_verified" className="h-5 w-5" />
            Identity verified
          </label>
        )}
      </fieldset>
      <SubmitButton pendingText="Recording…">Record appointment</SubmitButton>
    </form>
  );
}
