import { AppShell, PageTitle } from "@/components/AppShell";
import { SubmitButton, Toast } from "@/components/feedback";
import { Card } from "@/components/ui";
import { requireSignedIn } from "@/lib/auth";
import { errorMessage, savedMessage } from "@/lib/messages";
import { FREQUENCIES, type Frequency } from "@/lib/reminders";
import { SYSTEM_ROLE_LABELS } from "@/lib/roles";
import { saveReminders } from "./actions";

export const dynamic = "force-dynamic";

// Email reminders: how often this person hears about what is waiting for them.
export default async function RemindersPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const sp = await searchParams;
  const { supabase, user, systemRole, displayName, hasTwoFactor } = await requireSignedIn();
  const { data } = await supabase.from("reminder_preferences").select("frequency").eq("user_id", user.id).maybeSingle();
  const frequency = ((data?.frequency as Frequency | undefined) ?? "weekly") as Frequency;
  const { data: log } = await supabase.from("reminder_log").select("sent_on, ok").eq("user_id", user.id).order("sent_on", { ascending: false }).limit(1);
  const last = (log ?? [])[0] as { sent_on: string; ok: boolean } | undefined;

  return (
    <AppShell
      crumbs={[["My families", "/"], ["Email reminders"]]}
      section={null}
      user={{ name: displayName, roleLabel: systemRole ? SYSTEM_ROLE_LABELS[systemRole] : null, hasTwoFactor }}
    >
      {sp.error && <Toast key={`e-${sp.error}-${Date.now()}`} kind="error" message={errorMessage(sp.error)!} />}
      {sp.saved && !sp.error && <Toast key={`s-${sp.saved}-${Date.now()}`} message={savedMessage(sp.saved)!} />}
      <PageTitle title="Email reminders" subtitle="A short email about what is waiting for you in Village Square: for each family, how many to-dos, reviews and approvals are waiting." />
      <div className="space-y-5">
        <Card title="How often">
          <form action={saveReminders} className="space-y-4">
            <fieldset>
              <legend className="sr-only">How often</legend>
              {(Object.keys(FREQUENCIES) as Frequency[]).map((f) => (
                <label key={f} className="flex min-h-11 items-center gap-3 text-ink">
                  <input type="radio" name="frequency" value={f} defaultChecked={f === frequency} className="h-5 w-5" />
                  {FREQUENCIES[f]}
                </label>
              ))}
            </fieldset>
            <SubmitButton>Save</SubmitButton>
          </form>
          <p className="mt-3 text-sm text-ink-3">{last ? `Last reminder: ${new Date(`${last.sent_on}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.` : "No reminder sent yet."} You only get one when something is waiting.</p>
        </Card>
        <Card title="What the email says">
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
            <li>Only how many items are waiting, for each family. No names, titles or details are ever put in an email.</li>
            <li>There is no link in it, on purpose. Turnstone never emails a link to sign in, so you can be sure a reminder is genuine: sign in the way you always do.</li>
          </ul>
        </Card>
      </div>
    </AppShell>
  );
}
