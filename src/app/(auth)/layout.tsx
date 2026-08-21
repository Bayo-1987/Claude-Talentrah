import Link from "next/link";
import { AuthHero } from "@/components/auth/auth-hero";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen md:grid-cols-2">
      <div className="hidden md:flex">
        <AuthHero />
      </div>
      <div className="flex flex-col">
        <div className="flex items-center justify-between border-b border-line px-6 py-5 md:hidden">
          <Link
            href="/"
            className="font-display text-[22px] font-medium text-ink no-underline"
          >
            Talentrah
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center px-6 py-12">
          <div className="w-full max-w-[440px]">{children}</div>
        </div>
      </div>
    </div>
  );
}
