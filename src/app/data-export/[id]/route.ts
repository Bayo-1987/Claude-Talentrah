import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { emptyAnswer, handleDownload } from "@/lib/data-export/download";

export const dynamic = "force-dynamic";
// Streaming a stored file and deleting it: well inside the platform default, but pinned as a literal like the other long routes.
export const maxDuration = 300;

/**
 * GET /data-export/<id>: the link in the second email of an admin-produced data export. Everything it decides is in handleDownload (src/lib/data-export/download.ts).
 *
 * HEAD and OPTIONS are EXPLICIT handlers that answer empty and never touch the database: the bundled Next docs do not say what HEAD does when only GET is exported, and a HEAD that ran the GET
 * handler would use up the single use for a link scanner. tests/data-export/download-route.test.ts records what each method does.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  return handleDownload(request, id, {
    service: createServiceRoleClient(),
    getUser: async () => {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      return user ? { id: user.id } : null;
    },
  });
}

export async function HEAD(): Promise<Response> {
  return emptyAnswer("GET, HEAD, OPTIONS");
}

export async function OPTIONS(): Promise<Response> {
  return emptyAnswer("GET, HEAD, OPTIONS");
}
