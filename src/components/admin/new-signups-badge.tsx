"use client";

import { useEffect, useState } from "react";
import { countNewSignupsAction } from "@/lib/admin/people/actions";
import { POLL_INTERVAL_MS } from "@/lib/admin/people/signups";

/**
 * "N new since you loaded this", and a link to go and see them.
 *
 * A POLL, NOT A PUSH. The ask was to see signups as they happen without hitting
 * refresh; on a support console that means "tell me there is something new",
 * not "stream it". One integer a minute costs an indexed count and no
 * connection state — a realtime subscription would add a socket to keep alive
 * and a reconnect path, for a page an operator has open a few minutes a day.
 *
 * IT DOES NOT REFRESH THE TABLE BY ITSELF. Rows appearing under a cursor while
 * someone is reading is how a wrong row gets clicked, and each render of the
 * list is an audited view — a self-refreshing table would write an audit entry
 * every minute that nobody performed. The operator decides when to look.
 */
export function NewSignupsBadge({ since }: { since: string }) {
  const [count, setCount] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const n = await countNewSignupsAction(since);
        if (!cancelled) {
          setCount(n);
          setFailed(false);
        }
      } catch {
        // Say so rather than showing a stale zero: "0 new" and "I could not
        // ask" look identical and mean opposite things.
        if (!cancelled) setFailed(true);
      }
    };

    const id = setInterval(check, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [since]);

  if (failed) {
    return (
      <span className="text-[13.5px] text-ink-soft" data-testid="new-signups">
        Could not check for new signups.
      </span>
    );
  }

  if (count === 0) {
    return (
      <span className="text-[13.5px] text-ink-soft" data-testid="new-signups">
        Nothing new since you opened this.
      </span>
    );
  }

  return (
    <a
      href="/admin/people/signups"
      className="border-[1.5px] border-coral bg-coral-soft px-3 py-1.5 text-[13.5px] text-coral no-underline hover:bg-coral hover:text-bg"
      data-testid="new-signups"
    >
      {count} new since you opened this — reload
    </a>
  );
}
