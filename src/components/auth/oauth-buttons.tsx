import { signInWithOAuthAction } from "@/lib/auth/actions";

/**
 * Google/LinkedIn need real OAuth app credentials configured in the Supabase
 * dashboard (Authentication > Providers) before these work — see the comment
 * on signInWithOAuthAction. The buttons render either way, matching the
 * signup screen spec, but will surface a login-page error until that setup
 * is done.
 */
export function OAuthButtons() {
  return (
    <div className="flex flex-col gap-3">
      <form action={signInWithOAuthAction}>
        <input type="hidden" name="provider" value="google" />
        <button
          type="submit"
          className="flex min-h-11 w-full items-center justify-center gap-2 border-[1.5px] border-ink bg-transparent font-body text-[14px] font-semibold text-ink transition-colors hover:border-rust hover:text-rust"
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
            <path
              d="M17.5 10.2c0-.6-.05-1.2-.15-1.7H10v3.3h4.2a3.6 3.6 0 0 1-1.55 2.35v2h2.5c1.45-1.35 2.35-3.3 2.35-5.95Z"
              fill="currentColor"
            />
            <path
              d="M10 18c2.1 0 3.85-.7 5.15-1.85l-2.5-2c-.7.45-1.6.75-2.65.75-2.05 0-3.8-1.4-4.4-3.25h-2.6v2.05A8 8 0 0 0 10 18Z"
              fill="currentColor"
            />
            <path
              d="M5.6 11.65a4.8 4.8 0 0 1 0-3.3V6.3H3a8 8 0 0 0 0 7.4l2.6-2.05Z"
              fill="currentColor"
            />
            <path
              d="M10 4.75c1.15 0 2.15.4 2.95 1.15l2.2-2.2A7.95 7.95 0 0 0 10 2a8 8 0 0 0-7 4.3l2.6 2.05C6.2 6.15 7.95 4.75 10 4.75Z"
              fill="currentColor"
            />
          </svg>
          Continue with Google
        </button>
      </form>
      <form action={signInWithOAuthAction}>
        <input type="hidden" name="provider" value="linkedin_oidc" />
        <button
          type="submit"
          className="flex min-h-11 w-full items-center justify-center gap-2 border-[1.5px] border-ink bg-transparent font-body text-[14px] font-semibold text-ink transition-colors hover:border-rust hover:text-rust"
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
            <rect x="2" y="2" width="16" height="16" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="6.3" cy="6.3" r="1.1" fill="currentColor" />
            <path d="M6.3 9v5.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <path
              d="M9.5 14.5V9m0 0c0-1.4 1.1-2 2-2s2 .8 2 2.3v4.2"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
          Continue with LinkedIn
        </button>
      </form>
    </div>
  );
}
