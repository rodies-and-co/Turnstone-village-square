"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSignedIn } from "@/lib/auth";
import { FREQUENCIES } from "@/lib/reminders";

// Each person chooses how often they get email reminders (kept in the hub).
export async function saveReminders(form: FormData) {
  const { supabase, user } = await requireSignedIn();
  const v = form.get("frequency");
  const frequency = typeof v === "string" && v in FREQUENCIES ? v : null;
  if (!frequency) redirect("/settings/reminders?error=Please+choose+how+often.");
  const { error } = await supabase.from("reminder_preferences").upsert({ user_id: user.id, frequency, updated_at: new Date().toISOString() });
  revalidatePath("/settings/reminders");
  redirect(`/settings/reminders?${new URLSearchParams(error ? { error: "That couldn't be saved. Please try again." } : { saved: "reminders_saved" })}`);
}
