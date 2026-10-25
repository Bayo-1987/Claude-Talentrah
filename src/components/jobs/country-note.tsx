import type { TrackedCountry } from "@/lib/jobs/country";

/**
 * The honest limit of "country OR remote", stated every time a country is actually chosen, naming it. Nothing at all with no country: the line must never talk about a
 * country the person did not pick. "Remote" on a listing is a fact about work_type, not a claim about who is eligible; some of these roles name a single required
 * country in their own description that this filter has no reliable way to read.
 */
export function CountryNote({ country }: { country: TrackedCountry | undefined }) {
  if (!country) return null;
  return (
    <p className="text-[12.5px] italic text-ink-soft">
      Showing roles in {country} plus every remote listing on the board. Remote doesn&apos;t always mean open to any country — some roles are restricted to a specific one in the
      listing itself.
    </p>
  );
}
