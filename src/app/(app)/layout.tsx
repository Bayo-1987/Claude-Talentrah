import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { Masthead } from "@/components/app-shell/masthead";
import { FarahPanel } from "@/components/app-shell/farah-panel";

const INITIAL_HISTORY_LIMIT = 20;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, profile } = await requireUser();
  const initials = `${profile.first_name?.[0] ?? ""}${profile.last_name?.[0] ?? ""}`;

  const supabase = await createClient();
  const { data: historyRows } = await supabase
    .from("farah_messages")
    .select("id, role, content, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(INITIAL_HISTORY_LIMIT);
  const initialMessages = [...(historyRows ?? [])].reverse();

  return (
    <div className="min-h-screen">
      <div className="print:hidden">
        <Masthead creditsBalance={profile.credits_balance} initials={initials} />
      </div>
      <div className="mx-auto flex w-full max-w-[1360px] print:block print:max-w-none">
        <div className="min-w-0 flex-1 px-10 py-8 print:p-0">{children}</div>
        <div className="print:hidden">
          <FarahPanel firstName={profile.first_name ?? "there"} initialMessages={initialMessages} />
        </div>
      </div>
    </div>
  );
}
