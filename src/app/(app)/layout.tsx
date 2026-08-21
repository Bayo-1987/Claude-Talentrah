import { requireUser } from "@/lib/auth/require-user";
import { Masthead } from "@/components/app-shell/masthead";
import { FarahPanel } from "@/components/app-shell/farah-panel";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireUser();
  const initials = `${profile.first_name?.[0] ?? ""}${profile.last_name?.[0] ?? ""}`;

  return (
    <div className="min-h-screen">
      <Masthead creditsBalance={profile.credits_balance} initials={initials} />
      <div className="mx-auto flex w-full max-w-[1360px]">
        <div className="min-w-0 flex-1 px-10 py-8">{children}</div>
        <FarahPanel firstName={profile.first_name ?? "there"} />
      </div>
    </div>
  );
}
