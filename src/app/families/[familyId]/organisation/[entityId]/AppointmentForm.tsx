"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/feedback";
import { APPOINTMENT_ROLES, type AppointmentRole } from "@/lib/entity-checklist";

const label = "mb-1 block text-sm font-medium text-ink";

const ORG_KINDS: [string, string][] = [
  ["trust_company", "Trust company"],
  ["registered_agent", "Registered agent"],
  ["corporate_services", "Corporate services provider"],
  ["management_company", "Management company"],
  ["law_firm", "Law firm"],
  ["accounting_firm", "Accounting or audit firm"],
  ["bank", "Bank"],
  ["company", "Company"],
  ["other", "Other"],
];

// Appoint an officer: choose the role, then whether a person in the Tree or
// an outside organisation holds it. Only the fields that apply are shown.
export function AppointmentForm({
  action,
  roles,
  people,
  organisations,
  jurisdiction,
}: {
  action: (form: FormData) => Promise<void>;
  roles: AppointmentRole[];
  people: [string, string][];
  organisations: [string, string][];
  jurisdiction: string;
}) {
  const [role, setRole] = useState<string>(roles[0] ?? "director");
  const [holder, setHolder] = useState<"person" | "organisation">("person");
  const [orgId, setOrgId] = useState("");
  const others = (Object.keys(APPOINTMENT_ROLES) as AppointmentRole[]).filter((r) => !roles.includes(r));

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
        <fieldset>
          <legend className={label}>Held by</legend>
          <div className="flex gap-4">
            {(["person", "organisation"] as const).map((h) => (
              <label key={h} className="flex min-h-11 items-center gap-2 text-ink">
                <input type="radio" name="holder" value={h} checked={holder === h} onChange={() => setHolder(h)} className="h-5 w-5" />
                {h === "person" ? "A person" : "An organisation"}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor="appointed_on" className={label}>
            Appointed on
          </label>
          <input id="appointed_on" name="appointed_on" type="date" className="text-input" />
        </div>
      </div>

      {holder === "person" ? (
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
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label htmlFor="organisation_id" className={label}>
              Organisation
            </label>
            <select id="organisation_id" name="organisation_id" value={orgId} onChange={(e) => setOrgId(e.target.value)} className="text-input">
              <option value="">A new organisation (type below)</option>
              {organisations.map(([id, n]) => (
                <option key={id} value={id}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          {!orgId && (
            <>
              <div>
                <label htmlFor="organisation_name" className={label}>
                  New organisation&apos;s name
                </label>
                <input id="organisation_name" name="organisation_name" className="text-input" required />
              </div>
              <div>
                <label htmlFor="organisation_kind" className={label}>
                  Kind
                </label>
                <select id="organisation_kind" name="organisation_kind" defaultValue={role === "registered_agent" ? "registered_agent" : role === "trustee" ? "trust_company" : "other"} className="text-input">
                  {ORG_KINDS.map(([v, t]) => (
                    <option key={v} value={v}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
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
        {holder === "organisation" && (
          <label className="flex min-h-11 items-center gap-2 text-ink">
            <input type="checkbox" name="licensed" className="h-5 w-5" />
            Licensed (e.g. licensed trust company or agent)
          </label>
        )}
      </fieldset>
      <SubmitButton pendingText="Recording…">Record appointment</SubmitButton>
    </form>
  );
}
