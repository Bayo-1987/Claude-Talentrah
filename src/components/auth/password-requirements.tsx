import { getPasswordRequirements } from "@/lib/auth/password";

export function PasswordRequirements({ password }: { password: string }) {
  const requirements = getPasswordRequirements(password);
  return (
    <ul className="flex flex-col gap-1">
      {requirements.map((r) => (
        <li
          key={r.key}
          className="flex items-center gap-2 text-[12.5px]"
          style={{ color: r.met ? "var(--green)" : "var(--ink-soft)" }}
        >
          <svg width="10" height="10" viewBox="0 0 20 20" fill="none">
            {r.met ? (
              <path
                d="M4 10.5 L8 15 L16 5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : (
              <circle cx="10" cy="10" r="3" fill="currentColor" />
            )}
          </svg>
          {r.label}
        </li>
      ))}
    </ul>
  );
}
