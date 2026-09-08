"use client";

import { useActionState, useState } from "react";
import {
  createOrganizationAction,
  joinOrganizationAction,
  type EmployerActionState,
} from "@/lib/employer/actions";
import { BorderedCard, Button, EyebrowLabel, TextField } from "@/components/ui";

export interface JoinableOrg {
  id: string;
  name: string;
}

export function OrgOnboardingForm({
  joinable,
  userEmail,
  emailConfirmed,
  suggestedDomain,
  consumerEmailDomain,
}: {
  joinable: JoinableOrg[];
  userEmail: string | null;
  emailConfirmed: boolean;
  /** The user's own work-email domain, pre-filled because it is the value that verifies. */
  suggestedDomain: string | null;
  /**
   * True when the account's own address is at a personal provider, so NO value
   * typed into the domain field can verify it. Computed on the server, where
   * `isConsumerEmailDomain` already lives.
   */
  consumerEmailDomain: boolean;
}) {
  const [createState, createFormAction, creating] = useActionState<EmployerActionState, FormData>(
    createOrganizationAction,
    null,
  );
  const [joinState, joinFormAction, joining] = useActionState<EmployerActionState, FormData>(
    joinOrganizationAction,
    null,
  );
  const [domain, setDomain] = useState(suggestedDomain ?? "");

  const createError = createState && "error" in createState ? createState.error : null;
  const joinError = joinState && "error" in joinState ? joinState.error : null;

  return (
    <div className="flex flex-col gap-8">
      {!emailConfirmed && (
        <p className="border-[1.5px] border-amber bg-[oklch(96%_0.03_70)] px-4 py-3 text-[13.5px] text-ink">
          Confirm your email address to get your company verified. You can set the company up now
          either way — jobs stay private to your team until it&apos;s verified.
        </p>
      )}

      {/*
        SAID HERE, BEFORE THE WORK, NOT ON JOBS POSTED AFTER IT.

        An account at a personal provider cannot be verified by anything typed
        into the domain field below: evaluateDomainVerification compares the
        claimed domain against the ACCOUNT'S OWN email domain, so typing
        gmail.com is refused as a consumer domain and typing a real company
        domain is a mismatch. There is no third answer. Until now the only
        warning on this screen was the unconfirmed-email one, which never fires
        for an OAuth signup because their address arrives already confirmed —
        so the people this affects most saw nothing at all, created a company,
        wrote a job, posted it, and found out on Jobs Posted.

        This is ADDITIVE. The !emailConfirmed banner above still fires for an
        unconfirmed non-consumer signup and is untouched; this one is the
        different case of "confirmed, and still cannot verify this way".
      */}
      {consumerEmailDomain && (
        <div className="border-[1.5px] border-amber bg-[oklch(96%_0.03_70)] px-4 py-3">
          <p className="text-[13.5px] text-ink">
            <span className="font-semibold">
              Your account uses a personal email provider
              {userEmail ? <> ({userEmail})</> : null}.
            </span>{" "}
            No company domain entered below will verify it automatically — verification matches a
            domain against your own account&apos;s email address, and a personal one can never
            match.
          </p>
          <p className="mt-2 text-[13.5px] text-ink-soft">
            You can still set the company up now and post jobs; they stay private to your team
            until it&apos;s verified. Once it&apos;s set up, you can submit your CAC (Corporate
            Affairs Commission) business registration number from Company Profile for an admin to
            confirm by hand. Inviting a teammate whose email is on your company&apos;s domain is a
            separate route that&apos;s still coming.
          </p>
        </div>
      )}

      {joinable.length > 0 && (
        <section>
          <EyebrowLabel>Join your team</EyebrowLabel>
          <h2 className="mt-2 font-display text-[24px] font-medium text-ink">
            {joinable.length === 1
              ? "Someone from your company is already here"
              : "These companies match your work email"}
          </h2>
          <p className="mt-1.5 font-body text-[14px] text-ink-soft">
            Your email domain matches, so you can join without setting anything up again.
          </p>
          {joinError && (
            <p className="mt-3 border-[1.5px] border-rust bg-rust-soft px-3.5 py-2.5 text-[13.5px] text-rust">
              {joinError}
            </p>
          )}
          <div className="mt-4 flex flex-col gap-3">
            {joinable.map((org) => (
              <BorderedCard key={org.id} className="flex items-center justify-between gap-4 p-4">
                <span className="font-display text-[17px] font-semibold text-ink">{org.name}</span>
                <form action={joinFormAction}>
                  <input type="hidden" name="organizationId" value={org.id} />
                  <Button type="submit" size="sm" disabled={joining}>
                    {joining ? "Joining…" : "Join"}
                  </Button>
                </form>
              </BorderedCard>
            ))}
          </div>
        </section>
      )}

      <section>
        <EyebrowLabel>{joinable.length > 0 ? "Or start a new one" : "Set up your company"}</EyebrowLabel>
        <h2 className="mt-2 font-display text-[24px] font-medium text-ink">
          Tell us about your company
        </h2>
        <p className="mt-1.5 max-w-[52ch] font-body text-[14px] text-ink-soft">
          Posting jobs on Talentrah is free. We verify companies by work email domain — if your
          account email is at the domain you enter, you&apos;re verified straight away.
        </p>

        {createError && (
          <p className="mt-4 border-[1.5px] border-rust bg-rust-soft px-3.5 py-2.5 text-[13.5px] text-rust">
            {createError}
          </p>
        )}

        <BorderedCard className="mt-5 p-6">
          <form action={createFormAction} className="flex flex-col gap-5">
            <TextField label="Company name" name="name" required placeholder="e.g. Zaria Digital" />
            <div className="flex flex-col gap-1.5">
              <TextField
                label="Company website domain"
                name="domain"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="e.g. zariadigital.com"
              />
              <p className="font-body text-[12.5px] text-ink-soft">
                {userEmail ? (
                  <>
                    Your account email is <span className="font-semibold">{userEmail}</span>.
                    {consumerEmailDomain ? (
                      <>
                        {" "}
                        Enter your company&apos;s domain — it is stored on the company either way,
                        and is what a teammate invite or CAC check would be matched against.
                      </>
                    ) : (
                      <> Enter the matching company domain to be verified now.</>
                    )}
                  </>
                ) : (
                  "Enter your company's own domain — personal email providers don't count."
                )}
              </p>
            </div>
            <TextField
              label="What the company does (optional)"
              name="description"
              placeholder="One or two sentences"
            />
            <div>
              <Button type="submit" disabled={creating}>
                {creating ? "Creating…" : "Create company"}
              </Button>
            </div>
          </form>
        </BorderedCard>
      </section>
    </div>
  );
}
