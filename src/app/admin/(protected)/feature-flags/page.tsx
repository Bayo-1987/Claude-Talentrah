import { requirePermission } from "@/lib/admin/require-admin";
import { listFeatureFlags } from "@/lib/admin/flags/list";
import { FeatureFlagRow } from "@/components/admin/feature-flag-row";
import { QueueHeader } from "@/components/admin/queue-chrome";
import { Container, EyebrowLabel, BorderedCard } from "@/components/ui";

export const metadata = {
  title: "Feature flags — Talentrah admin",
  robots: { index: false, follow: false },
};

/**
 * Features that are built but not necessarily on.
 *
 * NOT A QUEUE, and not part of Operations. Operations is committed by its own
 * header to staying read-only with no controls, and a switch that changes what
 * users receive does not belong on a page that promises to change nothing —
 * so this has its own permission (`feature_flags`, 0080) rather than borrowing
 * one that means something else.
 *
 * FLAGS ARE CREATED BY MIGRATION, not here. A flag invented from a form is a
 * key nothing in the code checks, which reads as a feature switched on and is
 * not. This page turns existing switches on and off; adding one is a change to
 * the code that reads it, and belongs beside that code.
 */
export default async function FeatureFlagsPage() {
  const admin = await requirePermission("feature_flags");
  const flags = await listFeatureFlags();
  const on = flags.filter((f) => f.enabled).length;

  return (
    <Container className="flex max-w-[900px] flex-col gap-8 py-12">
      <QueueHeader
        eyebrow="Feature flags"
        title="What is switched on."
        blurb="Each of these gates a feature that is built and deployed. Turning one on takes effect immediately for everyone — there is no rollout percentage and no per-user targeting, so treat it as on or off for all users."
        adminLabel={admin.displayName || admin.email}
      />

      <BorderedCard className="flex flex-col gap-2 p-5">
        <EyebrowLabel>Status</EyebrowLabel>
        <p className="text-[15px]">
          {on} of {flags.length} on
        </p>
      </BorderedCard>

      <ul className="flex list-none flex-col gap-4 p-0">
        {flags.map((f) => (
          <li key={f.key}>
            <BorderedCard className="flex flex-col gap-4 p-5">
              <div className="flex flex-col gap-1.5">
                <EyebrowLabel>{f.enabled ? "On" : "Off"}</EyebrowLabel>
                <h2 className="font-display text-[20px] font-semibold leading-snug">{f.label}</h2>
                {/* The key, because it is what appears in the code and in a log. */}
                <p className="font-body text-[13px] text-ink-soft">{f.key}</p>
                <p className="text-[13.5px] text-ink-soft">
                  Last changed {new Date(f.updatedAt).toLocaleDateString()}
                  {f.updatedByName ? ` by ${f.updatedByName}` : " · who changed it is not recorded"}
                </p>
              </div>
              <FeatureFlagRow flagKey={f.key} enabled={f.enabled} />
            </BorderedCard>
          </li>
        ))}
        {flags.length === 0 && (
          <li className="font-display italic text-ink-soft">
            No flags yet. They are added by migration alongside the code they gate.
          </li>
        )}
      </ul>
    </Container>
  );
}
