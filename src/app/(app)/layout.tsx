import { getOptionalUser } from "@/lib/auth/require-user";
import { MarketingMasthead } from "@/components/marketing/marketing-masthead";
import { Masthead } from "@/components/app-shell/masthead";
import { FarahPanel } from "@/components/app-shell/farah-panel";
import { FarahMobileTab } from "@/components/app-shell/farah-mobile-tab";
import { FarahFirstVisitHint } from "@/components/app-shell/farah-first-visit-hint";
import { visibleName, fullVisibleName, nameInitials } from "@/lib/profile/name";
import { getActivePass } from "@/lib/passes/entitlement";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  /*
   * OPTIONAL, not required — and the gate did not move, it was removed from a
   * place that was never the only one holding it.
   *
   * All fourteen pages under (app) call `requireUser` themselves; that was
   * checked one by one before this line changed, because relaxing a layout
   * gate is only safe if it was redundant. It was. Every route in this group
   * still redirects a signed-out visitor exactly as before — except
   * /jobs/[id], which now opts in to being public.
   *
   * WHY THAT PAGE HAD TO BE PUBLIC. It carries JobPosting structured data, and
   * Googlebot was being answered with a 302 to /login, so no posting was ever
   * eligible for Google for Jobs. A signed-out reader gets the full posting;
   * applying still requires an account.
   */
  const session = await getOptionalUser();

  if (!session) {
    /*
     * The signed-out shell: marketing chrome, no Farah.
     *
     * Farah is an authenticated feature backed by a per-user conversation, and
     * the first-visit hint reads a `profiles` column — neither has any meaning
     * without a user, and rendering an empty panel beside a job posting would
     * advertise a feature the reader cannot use. The content column keeps its
     * own widths so the posting itself is laid out identically either way.
     */
    return (
      <div className="min-h-screen">
        <div className="sticky top-0 z-20 print:hidden" data-testid="masthead-band">
          <MarketingMasthead />
        </div>
        <div className="mx-auto flex w-full max-w-[1360px] flex-col print:block print:max-w-none">
          <div
            data-testid="content-column"
            className="min-w-0 flex-1 px-6 py-8 min-[760px]:px-10 print:p-0"
          >
            {children}
          </div>
        </div>
      </div>
    );
  }

  const { profile } = session;
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

  /*
   * THE FARAH HISTORY READ IS GONE FROM HERE, and this is the one thing to
   * know before adding another query to this file.
   *
   * This layout wraps every page in the signed-in app, so anything awaited
   * here is awaited by the feed, the tracker, billing, settings and the rest
   * — whether or not that page has any use for it. `farah_messages` was the
   * clearest case: a second Supabase client, built solely to run one query,
   * for a side panel most readers never speak to. Production holds 43 Farah
   * messages across 40 accounts, so the overwhelming majority of page loads
   * paid a round trip to be told there was nothing.
   *
   * FarahPanel fetches it itself now (/api/farah/history), after paint.
   *
   * `getActivePass` stays, because the masthead cannot render without it —
   * the pass chip is chrome on this layout, not content on a page — and it
   * is request-memoized, so a page that also needs pass state shares this
   * one call rather than making a second.
   */
  const activePass = await getActivePass(session.user.id);

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
      <div
        data-testid="masthead-band"
        className="sticky top-0 z-20 print:hidden"
      >
        <Masthead
          creditsBalance={profile.credits_balance}
          activePass={activePass}
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
        <div
          data-testid="content-column"
          className="min-w-0 flex-1 px-6 py-8 min-[760px]:px-10 print:p-0"
        >
          {children}
        </div>
        {/*
          THE TINT LIVES HERE, NOT ON THE PANEL, and the difference is visible
          on every normal screen rather than at some far-scrolled extreme.

          FarahPanel's own div is `sticky` with a max-height, so it is only ever
          as tall as its content — measured at 511px against a content column of
          36,327px. Painting `bg-paper-alt` there left the field stopping 511px
          down while the feed carried on beside it: on a 900px viewport that is
          a seam of plain --paper visible before the fold, not below it.

          THIS wrapper is the flex item, so `align-items: stretch` makes it
          exactly as tall as the content column. The tint therefore runs the
          whole column, which is what a colour field means.

          THE LEFT HAIRLINE MOVED HERE TOO, for the same reason and not merely
          for tidiness. It is a BOUNDARY running the length of the field, not a
          marker of where content starts, so leaving it on the panel left it
          511px long against a 36,327px field — and CLAUDE.md's rule is to pair
          a divider WITH a background change, which was then true of only the
          top 1.4% of the column.

          Still min-[760px]:, so the stacked mobile view has no side rule to
          draw, exactly as before.

          The rust top rule and the mark beside the eyebrow stay on the panel
          itself: those DO mark where Farah's content begins, which is not the
          same place as where her column begins.
        */}
        <div className="bg-paper-alt min-[760px]:border-l min-[760px]:border-l-line print:hidden">
          <FarahPanel firstName={visibleName(profile.first_name) || "there"} />
        </div>
      </div>
      {/*
        Rendered from the AUTHENTICATED shell only. The marketing pages under
        (marketing) have their own layout and no Farah panel, so a global tab
        would point at an element that is not there.
      */}
      <FarahMobileTab />
      {/*
        The first-visit hint, gated on the SERVER rather than in the client.

        Rendering it always and letting it hide itself would mean every user who
        dismissed it months ago still ships the component, mounts it, and
        removes it after paint — a flash of chrome on every page load for the
        people who least want to see it. `profile` is already loaded above, so
        the check costs nothing.

        Null, not falsy: the column is a timestamp, and `!profile.x` would also
        be true for an empty string. There is no empty string in a timestamptz,
        but writing the check that way is how the next nullable column gets it
        wrong.
      */}
      {profile.farah_hint_dismissed_at === null && <FarahFirstVisitHint />}
    </div>
  );
}
