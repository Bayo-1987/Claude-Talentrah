import { getPasswordRequirements } from "@/lib/auth/password";

/**
 * The password rules, ticked off as the person types (signup and reset). Built from the one shared rule list
 * (src/lib/auth/password-rules.ts), so what is shown here is what the server enforces.
 *
 * A rule not yet met has to be easy to see, and not by colour alone (it used to be a faint dot):
 *   met      a green check, green text, and "Met: <rule>" for a screen reader
 *   not met  a cross (a different SHAPE), calmer ink text at the same weight, and "Not met: <rule>" for a screen reader
 * Both states take exactly the same room (same row box, same icon box, same text weight, no bold), so the list does not jump when a rule
 * flips while someone types. The markers are rust and green, the text ink-soft and green: every pair is at least 4.5:1 on paper, card and
 * paper-alt (tests/auth/password-requirements-checklist.test.tsx).
 *
 * The icon is decorative (aria-hidden); the state is carried by the hidden "Met:" / "Not met:" words. There is deliberately no live region:
 * announcing every keystroke would be noise; a screen-reader user reads the list when they reach it.
 */
export function PasswordRequirements({ password }: { password: string }) {
  const requirements = getPasswordRequirements(password);
  return (
    <ul className="flex flex-col gap-1.5">
      {requirements.map((r) => (
        <li key={r.key} className={`flex items-start gap-2 text-[12.5px] leading-[18px] ${r.met ? "text-green" : "text-ink-soft"}`}>
          <svg
            aria-hidden="true"
            data-icon={r.met ? "check" : "cross"}
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            className={`shrink-0 ${r.met ? "text-green" : "text-rust"}`}
          >
            {r.met ? (
              <path d="M3.5 8.5 L6.5 11.5 L12.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <path d="M4 4 L12 12 M12 4 L4 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            )}
          </svg>
          <span>
            <span className="sr-only">{r.met ? "Met: " : "Not met: "}</span>
            {r.label}
          </span>
        </li>
      ))}
    </ul>
  );
}
