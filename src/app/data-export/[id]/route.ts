import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { handleConfirm } from "@/lib/data-export/confirm";
import { ALLOW, emptyAnswer, handleDownload } from "@/lib/data-export/download";

export const dynamic = "force-dynamic";
// Streaming a stored file and deleting it (the POST): well inside the platform default, but pinned as a literal like the other long routes.
export const maxDuration = 300;

/**
 * /data-export/<id>: the link in the second email of an admin-produced data export.
 *
 *   GET   the confirm page. Read-only: it claims nothing, so any number of fetches (a second click, a scanner, an extension's refetch) is harmless. src/lib/data-export/confirm.ts.
 *   POST  the only thing that claims the file and streams it, once. src/lib/data-export/download.ts.
 *
 * ONE route handler, not a page plus a second route: a `page.tsx` and a `route.ts` cannot share a segment, so a page would need the POST at another path, and the handler returns the HTML itself
 * (no app layout, so none of the signed-in shell's strip, worker registration or analytics) with the exact 404 status and byte-identical refusal body the tests pin. The email link, and the form's
 * action, are the same path. docs/admin-data-export.md has the picture.
 *
 * HEAD and OPTIONS are EXPLICIT handlers that answer empty and never touch the database: the bundled Next docs do not say what HEAD does when only GET is exported, and a HEAD that ran the GET
 * handler would read the database for a link scanner. tests/data-export/download.test.ts records what each method does.
 */
function deps() {
  return {
    service: createServiceRoleClient(),
    getUser: async () => {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      return user ? { id: user.id } : null;
    },
  };
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  return handleConfirm(request, id, deps());
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  return handleDownload(request, id, deps());
}

export async function HEAD(): Promise<Response> {
  return emptyAnswer(ALLOW);
}

export async function OPTIONS(): Promise<Response> {
  return emptyAnswer(ALLOW);
}
