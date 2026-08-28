import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { Masthead } from "@/components/app-shell/masthead";
import { FarahPanel } from "@/components/app-shell/farah-panel";
import { visibleName, fullVisibleName, nameInitials } from "@/lib/profile/name";

const INITIAL_HISTORY_LIMIT = 20;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, profile } = await requireUser();
  /*
   * visibleName, not the raw column: neither of these trimmed at all before,
   * so a name of a single space — or a zero-width character, which .trim()
   * would not have caught either — produced a blank avatar and "Hi ,".
   *
   * nameInitials also UPPERCASES. The old inline version took the first
   * character as typed, so a profile saved as "ada lovelace" rendered "al" in
   * a circle whose type is styled for capitals.
   */
  const initials = nameInitials(profile.first_name, profile.last_name);
  const displayName = fullVisibleName(profile.first_name, profile.last_name);

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
      {/*
        The sticky belongs HERE, on the wrapper, and that is not a style
        preference.

        `position: sticky` moves an element within its PARENT's box. This
        wrapper is exactly as tall as the masthead inside it, so a sticky
        Masthead has nowhere to travel and simply scrolls away with its
        parent — measured at top:-2500 after a 2500px scroll, while the two
        other sticky elements on the same page held at 68. On the wrapper the
        parent is the `min-h-screen` div, which is the whole page, so there is
        room.

        Same failure the Farah panel's `self-start` exists to avoid, from the
        opposite direction: there the box was too TALL to move in, here it was
        too short.

        z-20 keeps it above the jobs page's own sticky filter header (z-10) so
        the two never contend for the same band of screen.
      */}
      <div className="sticky top-0 z-20 print:hidden">
        <Masthead
          creditsBalance={profile.credits_balance}
          initials={initials}
          email={profile.email}
          displayName={displayName}
        />
      </div>
      {/*
        Column-stacked below 760px, side-by-side above it.

        The panel is 280px and never shrank, so on a phone it took 280 of the
        viewport and left the content column what remained minus 80px of
        padding: measured 0px at 360, 30px at 390, 52px at 412. Not "cramped" —
        a content column of zero.

        Reflow rather than a launcher-and-sheet, and the reason is state. The
        panel is a client component holding a Farah conversation; a sheet means
        conditionally rendering it, which unmounts it and throws the
        conversation away on every rotation. Changing flex-direction moves the
        same mounted element, so nothing is lost crossing the breakpoint.
      */}
      <div className="mx-auto flex w-full max-w-[1360px] flex-col min-[760px]:flex-row print:block print:max-w-none">
        <div className="min-w-0 flex-1 px-6 py-8 min-[760px]:px-10 print:p-0">{children}</div>
        <div className="print:hidden">
          <FarahPanel firstName={visibleName(profile.first_name) || "there"} initialMessages={initialMessages} />
        </div>
      </div>
    </div>
  );
}
