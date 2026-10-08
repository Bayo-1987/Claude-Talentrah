/**
 * Whether the browser holds a Supabase session, asked without making the Supabase browser client part of the caller's static chunk list.
 *
 * The client (GoTrueClient and the cookie handling around it) is a large chunk. A static `import { createClient } from "@/lib/supabase/client"` puts it in the static chunk list of
 * every route that renders the importing component, so a router prefetch or a first paint carries it whether or not the page needs an answer in its first second. Loading it here, by
 * dynamic import inside the call, keeps it out of that list: it downloads right after mount instead, off the critical path. tests/ui/no-static-supabase-client-import.test.ts keeps
 * the rest of src/ from importing it statically.
 *
 * `getSession` reads the auth cookie and makes no network request, unlike `getUser`; the answer decides copy and which endpoint a form posts to, never whether anything is allowed
 * (the endpoints enforce their own auth). It REJECTS when the client cannot be built or the chunk cannot be fetched (offline), and each caller picks its own fallback: the sticky bar
 * stays hidden, the demo reads as signed-out.
 */
export async function readHasSession(): Promise<boolean> {
  const { createClient } = await import("@/lib/supabase/client");
  const {
    data: { session },
  } = await createClient().auth.getSession();
  return !!session;
}
