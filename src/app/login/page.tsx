import { SiteHeader } from "@/components/SiteHeader";
import { signIn } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-md px-6 py-12">
        <div className="rounded-2xl border border-border bg-card p-8">
          <h1 className="text-2xl font-semibold text-ink">Sign in</h1>

          {error && (
            <p role="alert" className="alert mt-6">
              That email and password didn&apos;t match. Please try again.
            </p>
          )}

          <form action={signIn} className="mt-6 space-y-5">
            <div>
              <label htmlFor="email" className="mb-1 block font-medium text-ink">
                Email
              </label>
              <input id="email" name="email" type="email" autoComplete="email" required className="text-input" />
            </div>
            <div>
              <label htmlFor="password" className="mb-1 block font-medium text-ink">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="text-input"
              />
            </div>
            <button type="submit" className="btn-primary w-full">
              Sign in
            </button>
          </form>

          <p className="mt-6 text-sm text-ink">
            Accounts are created by your administrator. There is no public sign-up.
          </p>
        </div>
      </main>
    </>
  );
}
