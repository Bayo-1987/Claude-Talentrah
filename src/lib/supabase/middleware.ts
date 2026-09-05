import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";
import type { Database } from "./types";
import { PATH_HEADER } from "@/lib/auth/redirect-to";

/**
 * Refreshes the Supabase auth session on every request so Server Components
 * always see a valid (non-expired) session cookie. Required by @supabase/ssr
 * — see src/lib/supabase/server.ts's comment on why it can't set cookies from
 * a Server Component alone.
 *
 * Also returns the `user` this call already fetched, so `proxy.ts`'s seeker-app
 * gate (see there) can decide whether to redirect WITHOUT a second
 * `auth.getUser()` round trip — this is the one call that was always going to
 * happen anyway.
 */
export async function updateSession(
  request: NextRequest,
): Promise<{ response: NextResponse; user: User | null }> {
  /*
   * Stamp the path onto the request so a Server Component can know where it
   * is. `requireUser()` needs it to build a return trip, and a Server
   * Component has no request object — `headers()` is the only channel, and
   * nothing populates a path header by default.
   *
   * Set on the REQUEST, not the response: it is for our own server to read
   * during render, not something to send to the browser.
   */
  request.headers.set(PATH_HEADER, request.nextUrl.pathname + request.nextUrl.search);

  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Required to actually refresh the session — do not remove.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
}
