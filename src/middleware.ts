import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // The scheduled reminders job checks its own secret (no one is signed in).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/reminders).*)"],
};
