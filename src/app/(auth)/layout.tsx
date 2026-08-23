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
          <Link href="/" className="flex items-center no-underline">
            {/* eslint-disable-next-line @next/next/no-img-element -- static brand SVG, next/image's optimizer needs SVG allow-listing for no real benefit here */}
            <img
              src="/talentrah-horizontal.svg"
              alt="Talentrah"
              width={320}
              height={80}
              className="h-7 w-auto"
            />
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center px-6 py-12">
          <div className="w-full max-w-[440px]">{children}</div>
        </div>
      </div>
    </div>
  );
}
