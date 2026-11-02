import Link from "next/link";
import type { ReactNode } from "react";
import { PrintButton } from "@/components/PrintButton";
import {
  APPOINTMENT_ROLES,
  type AppointmentRole,
} from "@/lib/entity-checklist";
import type { FamilyContext } from "@/lib/family-context";
import {
  INTERESTS,
  beneficialOwners,
  formatShares,
  holderFrom,
  holderKey,
  ruleText,
  type BoRule,
  type Holder,
} from "@/lib/ownership";
import { registerList } from "@/lib/registers";
import {
  loadOrganisationData,
  type OrganisationData,
} from "../organisation-data";

// The statutory registers of one entity, each laid out as a formal document
// (like a registry's printed register): the entity's name and number at the
// top, then one block per person or firm with their dates, names, date of
// birth, nationality and address. Everything comes from what is recorded
// elsewhere: the Tree (names, date and country of birth, passports for
// nationality, maiden name for former names, home address), the service
// providers and the family's entities. Nothing is typed in twice.

type Addr = {
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postal_code: string | null;
  country: string;
};
type PersonInfo = {
  first: string;
  middle: string;
  last: string;
  maiden: string | null;
  dob: string | null;
  countryOfBirth: string | null;
  nationality: string[];
  address: Addr | null;
};
type CorporateInfo = {
  name: string;
  number: string | null;
  jurisdiction: string | null;
  incorporated: string | null;
  address: Addr | null;
};

const fmt = (d: string | null | undefined) =>
  d
    ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      })
    : "";

// --- Document pieces ----------------------------------------------------------

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[13rem_1fr] gap-4 py-0.5">
      <dt className="font-medium text-ink">{label}:</dt>
      <dd className="text-ink">{children || " "}</dd>
    </div>
  );
}

function Grid({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto print:overflow-visible">
      <table className="w-full min-w-[760px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-ink">
            {head.map((h) => (
              <th
                key={h}
                scope="col"
                className="py-1.5 pr-4 text-left font-semibold text-ink"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border">
              {r.map((c, j) => (
                <td key={j} className="py-1.5 pr-4 align-top text-ink">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const oneLine = (a: Addr) =>
  [a.line1, a.line2, a.city, a.region, a.postal_code, a.country]
    .filter(Boolean)
    .join(", ");

// Label and value pairs, two or three to a row; anything not recorded says so
// once, instead of leaving empty columns.
function Details({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3">
      {items.map(([k, v]) => (
        <div
          key={k}
          className={
            k === "Residential address" ||
            k === "Registered office" ||
            k === "Nature of interest"
              ? "sm:col-span-2 lg:col-span-3 print:col-span-3"
              : ""
          }
        >
          <dt className="text-xs font-medium uppercase tracking-wide text-ink-3">
            {k}
          </dt>
          <dd className="text-[15px] text-ink">
            {v || <span className="text-ink-3">Not recorded</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// The identity details of a person or a corporate holder.
function identityItems(
  person?: PersonInfo,
  corporate?: CorporateInfo,
): [string, ReactNode][] {
  if (person)
    return [
      ["First name", person.first],
      ["Middle name(s)", person.middle || "—"],
      ["Last name", person.last],
      ["Date of birth", fmt(person.dob)],
      ["Country of birth", person.countryOfBirth],
      ["Nationality", person.nationality.join(", ")],
      ...(person.maiden
        ? ([
            [
              "Former name",
              [person.first, person.middle, person.maiden]
                .filter(Boolean)
                .join(" "),
            ],
          ] as [string, ReactNode][])
        : []),
      ["Residential address", person.address ? oneLine(person.address) : null],
    ];
  if (corporate)
    return [
      ["Registration number", corporate.number],
      ["Place of incorporation", corporate.jurisdiction],
      ["Date of incorporation", fmt(corporate.incorporated)],
      [
        "Registered office",
        corporate.address ? oneLine(corporate.address) : null,
      ],
    ];
  return [];
}

// One person or firm in a register: their name and whether they are current,
// then the dates for this register and their details.
function Block({
  name,
  status,
  lines,
  about = [],
  children,
}: {
  name: string;
  status?: "Current" | "Former";
  lines: [string, ReactNode][];
  about?: [string, ReactNode][];
  children?: ReactNode;
}) {
  return (
    <section className="break-inside-avoid rounded-lg border border-border p-5 print:rounded-none print:border-x-0 print:border-b-0 print:border-t-2 print:border-t-ink print:px-0">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <h3 className="text-lg font-semibold text-ink">{name}</h3>
        {status && (
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${status === "Current" ? "bg-ink text-white print:border print:border-ink print:bg-transparent print:text-ink" : "border border-border text-ink-2"}`}
          >
            {status}
          </span>
        )}
      </header>
      <div className="space-y-4">
        {lines.length > 0 && <Details items={lines} />}
        {about.length > 0 && (
          <div className="border-t border-border pt-4">
            <Details items={about} />
          </div>
        )}
        {children}
      </div>
    </section>
  );
}

// A short list at the top of a register, so it can be read at a glance.
function Summary({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  if (rows.length < 2) return null;
  return (
    <div className="mb-6">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-3">
        At a glance
      </h3>
      <Grid head={head} rows={rows} />
    </div>
  );
}

// --- The tab --------------------------------------------------------------------

export async function RegistersTab({
  ctx,
  familyId,
  entity,
  register,
  rule,
}: {
  ctx: FamilyContext;
  familyId: string;
  entity: {
    id: string;
    name: string;
    entity_type: string;
    registration_number: string | null;
  };
  register: string | undefined;
  rule: BoRule | null;
}) {
  const data = await loadOrganisationData(ctx);
  const appts = data.appointments.filter((a) => a.entity_id === entity.id);
  const list = registerList(
    entity.entity_type,
    appts.map((a) => a.role),
  );
  const current = list.find(([k]) => k === register) ?? list[0];

  // Everyone who may appear, so their details are loaded once.
  const holders: Holder[] = [];
  const add = (h: Holder | null) => h && holders.push(h);
  appts.forEach((a) => add(a.holder));
  data.transactions
    .filter((t) => t.entity_id === entity.id)
    .forEach((t) => (add(t.to), add(t.from)));
  data.settlements
    .filter((s) => s.entity_id === entity.id)
    .forEach((s) => add(holderFrom(s)));
  data.beneficiaries
    .filter((b) => b.entity_id === entity.id)
    .forEach((b) => add(holderFrom(b)));
  data.classMembers
    .filter((m) => m.entity_id === entity.id)
    .forEach((m) => add({ kind: "person", id: m.person_id }));
  const owners = rule ? beneficialOwners(entity.id, data.graph, rule) : [];
  owners.forEach((o) => add(o.holder));
  const info = await loadDetails(ctx, data, holders);

  const today = new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  });
  const nameOf = (h: Holder | null) => {
    if (!h) return "";
    if (h.kind === "person") {
      const p = info.people.get(h.id);
      return p
        ? [p.first, p.middle, p.last].filter(Boolean).join(" ")
        : "Someone you can't see";
    }
    return info.corporate.get(holderKey(h))?.name ?? "";
  };
  // The identity details of whoever holds the role.
  const items = (h: Holder | null): [string, ReactNode][] =>
    !h
      ? []
      : h.kind === "person"
        ? identityItems(info.people.get(h.id))
        : identityItems(undefined, info.corporate.get(holderKey(h)));
  const statusOf = (ceased: string | null | undefined): "Current" | "Former" =>
    ceased ? "Former" : "Current";
  // Lines that only matter when filled in (e.g. "Notes") are left out when empty.
  const filled = (lines: [string, ReactNode][]) =>
    lines.filter(([, v]) => v !== "" && v !== null && v !== undefined);
  const currentFirst = <T,>(
    rows: T[],
    ceased: (r: T) => string | null | undefined,
    started: (r: T) => string | null | undefined,
  ) =>
    [...rows].sort(
      (a, b) =>
        Number(Boolean(ceased(a))) - Number(Boolean(ceased(b))) ||
        (started(a) ?? "").localeCompare(started(b) ?? ""),
    );

  const noun =
    {
      company: "Company",
      llc: "Company",
      trust: "Trust",
      foundation: "Foundation",
      partnership: "Partnership",
    }[entity.entity_type] ?? "Entity";
  let body: ReactNode = null;
  const [key, title] = current;

  if (key === "members") {
    const registers = data.registersFor(entity.id);
    const ledger = data.transactions.filter(
      (t) =>
        t.entity_id === entity.id &&
        t.status === "approved" &&
        t.kind !== "authorise",
    );
    const memberKeys = [
      ...new Set(
        ledger
          .flatMap((t) => [t.to, t.from])
          .filter(Boolean)
          .map((h) => holderKey(h!)),
      ),
    ];
    const members = currentFirst(
      memberKeys.map((k) => {
        const [kind, id] = k.split(":");
        const h = { kind, id } as Holder;
        const mine = ledger.filter(
          (t) =>
            (t.to && holderKey(t.to) === k) ||
            (t.from && holderKey(t.from) === k),
        );
        const holdings = registers
          .map((r) => ({
            r,
            h: r.holdings.find((x) => holderKey(x.holder) === k),
          }))
          .filter((x) => x.h);
        const total = holdings.reduce((n, x) => n + (x.h?.shares ?? 0), 0);
        return {
          k,
          h,
          mine,
          holdings,
          total,
          entered: mine[0]?.transaction_date ?? null,
          ceased:
            total === 0
              ? (mine[mine.length - 1]?.transaction_date ?? null)
              : null,
        };
      }),
      (m) => m.ceased,
      (m) => m.entered,
    );
    const held = (m: (typeof members)[number]) =>
      m.total === 0
        ? "None"
        : m.holdings
            .map((x) => `${formatShares(x.h!.shares)} ${x.r.shareClass.name}`)
            .join("; ");
    body = members.length ? (
      <>
        <Summary
          head={["Member", "Shares held", "Entered", "Ceased"]}
          rows={members.map((m) => [
            nameOf(m.h),
            held(m),
            fmt(m.entered),
            fmt(m.ceased) || "—",
          ])}
        />
        <div className="space-y-5">
          {members.map((m) => (
            <Block
              key={m.k}
              name={nameOf(m.h)}
              status={statusOf(m.ceased)}
              lines={[
                ["Date entered as member", fmt(m.entered)],
                ...filled([["Date ceased to be member", fmt(m.ceased)]]),
              ]}
              about={items(m.h)}
            >
              <div>
                <h4 className="mb-1 text-sm font-semibold text-ink">
                  Shares held
                </h4>
                {m.total === 0 ? (
                  <p className="text-ink-2">None held now.</p>
                ) : (
                  <Grid
                    head={[
                      "Class",
                      "Number of shares",
                      "Par value",
                      "Currency",
                      "Certificates",
                    ]}
                    rows={m.holdings.map((x) => [
                      x.r.shareClass.name,
                      formatShares(x.h!.shares),
                      x.r.shareClass.par_value !== null
                        ? String(Number(x.r.shareClass.par_value))
                        : "No par value",
                      x.r.shareClass.currency,
                      x.h!.certificates.map((c) => c.number).join(", "),
                    ])}
                  />
                )}
              </div>
              <div>
                <h4 className="mb-1 text-sm font-semibold text-ink">
                  Transactions
                </h4>
                <Grid
                  head={[
                    "Date",
                    "Transaction",
                    "Class",
                    "Shares",
                    "From / To",
                    "Certificate",
                    "Consideration",
                  ]}
                  rows={m.mine.map((t) => {
                    const incoming = t.to && holderKey(t.to) === m.k;
                    const cls = data.classes.find((c) => c.id === t.class_id);
                    return [
                      fmt(t.transaction_date),
                      t.kind === "issue"
                        ? "Allotment"
                        : incoming
                          ? "Transfer in"
                          : "Transfer out",
                      cls?.name ?? "",
                      `${incoming ? "" : "−"}${formatShares(t.shares)}`,
                      t.kind === "transfer"
                        ? nameOf(incoming ? t.from : t.to)
                        : "—",
                      incoming
                        ? (t.certificate_number ?? "")
                        : t.balance_certificate_number
                          ? `Balance ${t.balance_certificate_number}`
                          : "Cancelled",
                      t.consideration
                        ? `${cls?.currency ?? ""} ${Number(t.consideration).toLocaleString("en-GB")}`
                        : "—",
                    ];
                  })}
                />
              </div>
            </Block>
          ))}
        </div>
      </>
    ) : (
      <p className="text-ink-3">No members recorded yet.</p>
    );
  } else if (key === "beneficial_owners") {
    const interest = (o: (typeof owners)[number]) =>
      [
        o.percent !== null
          ? `${Math.round(o.percent * 100) / 100}% of the shares or votes`
          : null,
        ...o.reasons,
      ]
        .filter(Boolean)
        .join("; ");
    body = owners.length ? (
      <>
        <p className="mb-4 text-sm text-ink-3">
          Worked out under the rule: {rule ? ruleText(rule) : "none"}. Check
          before anything is filed.
        </p>
        <Summary
          head={["Beneficial owner", "Nature of interest"]}
          rows={owners.map((o) => [nameOf(o.holder), interest(o)])}
        />
        <div className="space-y-5">
          {owners.map((o) => (
            <Block
              key={holderKey(o.holder)}
              name={nameOf(o.holder)}
              lines={[
                ["Nature of interest", interest(o)],
                ...filled([
                  [
                    "Notes",
                    [
                      o.fallback &&
                        "Senior managing official: no individual meets the rule",
                      o.outside &&
                        "Outside organisation: its own owners aren't recorded",
                      o.unresolved && "Can't be looked through",
                    ]
                      .filter(Boolean)
                      .join("; "),
                  ],
                ]),
              ]}
              about={items(o.holder)}
            />
          ))}
        </div>
      </>
    ) : (
      <p className="text-ink-3">Nobody can be worked out yet.</p>
    );
  } else if (key === "settlors") {
    const rows = data.settlements.filter((s) => s.entity_id === entity.id);
    const kindOf = (s: (typeof rows)[number]) =>
      s.kind === "initial"
        ? entity.entity_type === "foundation"
          ? "Founder's endowment"
          : "First settlement"
        : "Addition to the capital";
    const given = (s: (typeof rows)[number]) =>
      [
        s.description,
        s.amount
          ? `${s.currency ?? ""} ${Number(s.amount).toLocaleString("en-GB")}`
          : null,
      ]
        .filter(Boolean)
        .join(", ");
    body = rows.length ? (
      <>
        <Summary
          head={[
            entity.entity_type === "foundation" ? "Founder" : "Settlor",
            "Type",
            "Date",
            "What was given",
          ]}
          rows={rows.map((s) => [
            nameOf(holderFrom(s)),
            kindOf(s),
            fmt(s.settled_on as string | null),
            given(s) || "—",
          ])}
        />
        <div className="space-y-5">
          {rows.map((s) => (
            <Block
              key={String(s.id)}
              name={nameOf(holderFrom(s))}
              lines={[
                ["Type", kindOf(s)],
                ["Date", fmt(s.settled_on as string | null)],
                ["What was given", given(s)],
              ]}
              about={items(holderFrom(s))}
            />
          ))}
        </div>
      </>
    ) : (
      <p className="text-ink-3">None recorded.</p>
    );
  } else if (key === "beneficiaries") {
    const named = currentFirst(
      data.beneficiaries.filter((b) => b.entity_id === entity.id),
      (b) => b.ceased_on as string | null,
      (b) => b.added_on as string | null,
    );
    const members = currentFirst(
      data.classMembers.filter((m) => m.entity_id === entity.id),
      (m) => m.ceased_on,
      (m) => m.added_on,
    );
    const nameB = (b: (typeof named)[number]) =>
      b.cause ? String(b.cause) : nameOf(holderFrom(b));
    const className = (m: (typeof members)[number]) =>
      data.beneficiaryClasses.find((c) => c.id === m.class_id)?.name ?? "";
    body =
      named.length || members.length ? (
        <>
          <Summary
            head={["Beneficiary", "Interest", "Added", "Ceased"]}
            rows={[
              ...named.map((b) => [
                nameB(b),
                INTERESTS[b.interest as keyof typeof INTERESTS] ?? "",
                fmt(b.added_on as string | null),
                fmt(b.ceased_on as string | null) || "—",
              ]),
              ...members.map((m) => [
                nameOf({ kind: "person", id: m.person_id }),
                `Member of ${className(m)}`,
                fmt(m.added_on),
                fmt(m.ceased_on) || "—",
              ]),
            ]}
          />
          <div className="space-y-5">
            {named.map((b) => (
              <Block
                key={String(b.id)}
                name={nameB(b)}
                status={statusOf(b.ceased_on as string | null)}
                lines={[
                  [
                    "Interest",
                    INTERESTS[b.interest as keyof typeof INTERESTS] ?? "",
                  ],
                  ...filled([
                    [
                      "Fixed share",
                      b.share_percent ? `${Number(b.share_percent)}%` : "",
                    ],
                  ]),
                  ["Date added", fmt(b.added_on as string | null)],
                  ...filled([
                    ["Date ceased", fmt(b.ceased_on as string | null)],
                  ]),
                  ...(b.cause
                    ? ([["Type", "Charitable cause"]] as [string, ReactNode][])
                    : []),
                ]}
                about={b.cause ? [] : items(holderFrom(b))}
              />
            ))}
            {members.map((m) => (
              <Block
                key={m.id}
                name={nameOf({ kind: "person", id: m.person_id })}
                status={statusOf(m.ceased_on)}
                lines={[
                  ["Class of beneficiaries", className(m)],
                  ["Date added", fmt(m.added_on)],
                  ...filled([["Date ceased", fmt(m.ceased_on)]]),
                ]}
                about={items({ kind: "person", id: m.person_id })}
              />
            ))}
          </div>
        </>
      ) : (
        <p className="text-ink-3">None recorded.</p>
      );
  } else {
    const role = key as AppointmentRole;
    const these = currentFirst(
      appts.filter((a) => a.role === role),
      (a) => a.ceased_on,
      (a) => a.appointed_on,
    );
    const typeOf = (a: (typeof these)[number]) =>
      a.holder?.kind === "person"
        ? APPOINTMENT_ROLES[role]
        : `Corporate ${APPOINTMENT_ROLES[role].toLowerCase()}`;
    body = (
      <>
        <Summary
          head={["Name", "Type", "Appointed", "Ceased"]}
          rows={these.map((a) => [
            nameOf(a.holder),
            typeOf(a),
            fmt(a.appointed_on),
            fmt(a.ceased_on) || "—",
          ])}
        />
        <div className="space-y-5">
          {these.map((a) => (
            <Block
              key={a.id}
              name={nameOf(a.holder)}
              status={statusOf(a.ceased_on)}
              lines={[
                ["Type", typeOf(a)],
                ["Date of appointment", fmt(a.appointed_on)],
                ...filled([["Date of cessation", fmt(a.ceased_on)]]),
              ]}
              about={items(a.holder)}
            />
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      {/* Printed: landscape, with only the register (the entity's page heading is left off). */}
      <style>
        {
          "@media print { @page { size: A4 landscape; margin: 12mm; } [data-page-title] { display: none; } }"
        }
      </style>
      <nav aria-label="Registers" className="print:hidden">
        <ul className="flex flex-wrap gap-2">
          {list.map(([k, t]) => (
            <li key={k}>
              <Link
                href={`/families/${familyId}/organisation/${entity.id}?tab=registers&register=${k}`}
                aria-current={k === key ? "page" : undefined}
                className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm ${k === key ? "border-ink bg-ink text-white" : "border-border bg-card text-ink hover:border-ink"}`}
              >
                {t.replace("Register of ", "")}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <article className="rounded-xl border border-border bg-white p-6 sm:p-8 print:border-0 print:p-0">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <h2 className="text-2xl font-semibold text-ink">{title}</h2>
          <PrintButton />
        </header>
        <dl className="mb-6 text-[15px]">
          <Line label={`${noun} Name`}>{entity.name}</Line>
          <Line label={`${noun} Number`}>
            {entity.registration_number ?? (
              <span className="text-ink-3">Not recorded</span>
            )}
          </Line>
          <Line label="As at">{today}</Line>
        </dl>
        <div>{body}</div>
        <p className="mt-6 text-xs text-ink-3">
          Prepared from the records kept in Turnstone Village Square. Check
          against the entity&apos;s statutory records before filing.
        </p>
      </article>
    </>
  );
}

// The details shown for each person or firm.
async function loadDetails(
  ctx: FamilyContext,
  data: OrganisationData,
  holders: Holder[],
) {
  const db = ctx.db!;
  const personIds = [
    ...new Set(holders.filter((h) => h.kind === "person").map((h) => h.id)),
  ];
  const [ppl, details, passports, homes] = personIds.length
    ? await Promise.all([
        db
          .from("people")
          .select("id, full_names, surname, maiden_name")
          .in("id", personIds),
        db
          .from("person_details")
          .select("person_id, date_of_birth, country_of_birth")
          .in("person_id", personIds),
        db
          .from("passports")
          .select("person_id, country")
          .in("person_id", personIds),
        db
          .from("person_addresses")
          .select(
            "person_id, kind, is_current, addresses(line1, line2, city, region, postal_code, country)",
          )
          .in("person_id", personIds),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }];
  const people = new Map<string, PersonInfo>();
  for (const p of (ppl.data ?? []) as {
    id: string;
    full_names: string;
    surname: string;
    maiden_name: string | null;
  }[]) {
    const [first, ...rest] = p.full_names.trim().split(/\s+/);
    const d = (
      (details.data ?? []) as {
        person_id: string;
        date_of_birth: string | null;
        country_of_birth: string | null;
      }[]
    ).find((x) => x.person_id === p.id);
    const home = (
      (homes.data ?? []) as {
        person_id: string;
        kind: string;
        is_current: boolean;
        addresses: Addr | Addr[] | null;
      }[]
    )
      .filter((a) => a.person_id === p.id && a.is_current)
      .sort((a, b) => Number(b.kind === "home") - Number(a.kind === "home"))[0];
    people.set(p.id, {
      first,
      middle: rest.join(" "),
      last: p.surname,
      maiden:
        p.maiden_name && p.maiden_name !== p.surname ? p.maiden_name : null,
      dob: d?.date_of_birth ?? null,
      countryOfBirth: d?.country_of_birth ?? null,
      // Nationality: the country of issue of each passport.
      nationality: [
        ...new Set(
          ((passports.data ?? []) as { person_id: string; country: string }[])
            .filter((x) => x.person_id === p.id)
            .map((x) => x.country),
        ),
      ],
      address: home
        ? Array.isArray(home.addresses)
          ? (home.addresses[0] ?? null)
          : home.addresses
        : null,
    });
  }

  const addressIds = [
    ...data.organisations.map((o) => o.address_id),
    ...data.entities.map((e) => e.registered_address_id),
  ].filter(Boolean) as string[];
  const { data: addrRows } = addressIds.length
    ? await db
        .from("addresses")
        .select("id, line1, line2, city, region, postal_code, country")
        .in("id", addressIds)
    : { data: [] };
  const addr = new Map(
    ((addrRows ?? []) as (Addr & { id: string })[]).map((a) => [a.id, a]),
  );
  const corporate = new Map<string, CorporateInfo>();
  for (const o of data.organisations) {
    corporate.set(`organisation:${o.id}`, {
      name: o.name,
      number: o.registration_number,
      jurisdiction: o.jurisdiction,
      incorporated: o.incorporated_on,
      address: o.address_id ? (addr.get(o.address_id) ?? null) : null,
    });
  }
  for (const e of data.entities) {
    corporate.set(`entity:${e.id}`, {
      name: e.name,
      number: e.registration_number,
      jurisdiction: e.jurisdiction,
      incorporated: e.registered_on,
      address: e.registered_address_id
        ? (addr.get(e.registered_address_id) ?? null)
        : null,
    });
  }
  return { people, corporate };
}
