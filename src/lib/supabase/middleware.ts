import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./types";

/**
 * Refreshes the Supabase auth session on every request so Server Components
 * always see a valid (non-expired) session cookie. Required by @supabase/ssr
 * — see src/lib/supabase/server.ts's comment on why it can't set cookies from
 * a Server Component alone.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  // TEMPORARY diagnostic for the production 500 ("URL and Key are required
  // to create a Supabase client!") — reports only length, never the value,
  // to confirm what Vercel's middleware runtime actually receives for these
  // two vars before assuming which one (or both) is missing/empty. Remove
  // once confirmed.
  console.log(
    `[diagnostic] NEXT_PUBLIC_SUPABASE_URL length=${(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").length} NEXT_PUBLIC_SUPABASE_ANON_KEY length=${(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").length}`,
  );

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
  await supabase.auth.getUser();

  return response;
}
