"use client";

import { useState } from "react";
import { PROVIDER_KINDS } from "@/lib/providers";

const label = "mb-1 block text-sm font-medium text-ink";


// The few fields needed to add a service provider on the spot. The rest
// (address, contact, regulator) are filled in on the Service providers page.
export function NewProviderFields({ prefix, defaultKind = "other", requireLicence }: { prefix: string; defaultKind?: string; requireLicence?: boolean }) {
  const [licensed, setLicensed] = useState(Boolean(requireLicence));
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <div>
        <label htmlFor={`${prefix}name`} className={label}>
          Provider&apos;s name (required)
        </label>
        <input id={`${prefix}name`} name={`${prefix}name`} required className="text-input" />
      </div>
      <div>
        <label htmlFor={`${prefix}kind`} className={label}>
          Kind
        </label>
        <select id={`${prefix}kind`} name={`${prefix}kind`} defaultValue={defaultKind} className="text-input">
          {PROVIDER_KINDS.map(([v, t]) => (
            <option key={v} value={v}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${prefix}jurisdiction`} className={label}>
          Jurisdiction
        </label>
        <input id={`${prefix}jurisdiction`} name={`${prefix}jurisdiction`} className="text-input" />
      </div>
      <label className="flex min-h-11 items-center gap-2 text-ink">
        <input type="checkbox" name={`${prefix}licensed`} checked={licensed} onChange={(e) => setLicensed(e.target.checked)} className="h-5 w-5" />
        Licensed (e.g. a licensed trust company or agent)
      </label>
      {licensed && (
        <div>
          <label htmlFor={`${prefix}licence_number`} className={label}>
            Licence number
          </label>
          <input id={`${prefix}licence_number`} name={`${prefix}licence_number`} className="text-input" />
        </div>
      )}
    </div>
  );
}
