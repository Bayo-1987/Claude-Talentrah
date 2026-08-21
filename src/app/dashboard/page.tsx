import { redirect } from "next/navigation";

/** /dashboard was the M1 placeholder home before the real Job Feed (M3) existed. */
export default function DashboardPage() {
  redirect("/jobs");
}
