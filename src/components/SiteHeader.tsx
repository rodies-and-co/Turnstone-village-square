import Link from "next/link";
import { signOut } from "@/app/actions";

export function SiteHeader({
  name,
  roleLabel,
  hasTwoFactor,
}: {
  name?: string;
  roleLabel?: string | null;
  hasTwoFactor?: boolean;
}) {
  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-3">
        <Link href="/" className="flex min-h-11 items-center gap-3 text-ink">
          {/* The Turnstone logo: public/Turnstone-Logo.jpg */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/Turnstone-Logo.jpg" alt="Turnstone" className="h-9 w-auto" />
          <span className="text-lg font-semibold">Village Square</span>
        </Link>
        {name && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-ink">
              {name}
              {roleLabel ? ` · ${roleLabel}` : ""}
            </span>
            {!hasTwoFactor && (
              <Link href="/mfa" className="btn-secondary">
                Set up two-factor
              </Link>
            )}
            <form action={signOut}>
              <button type="submit" className="btn-secondary">
                Sign out
              </button>
            </form>
          </div>
        )}
      </div>
    </header>
  );
}
