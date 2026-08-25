import { redirect } from "next/navigation";
import { getEmployerContext } from "@/lib/employer/membership";

/** Entry point: straight to the listings if they have an org, onboarding if not. */
export default async function EmployerIndexPage() {
  const context = await getEmployerContext();
  redirect(context ? "/employer/jobs" : "/employer/onboarding");
}
