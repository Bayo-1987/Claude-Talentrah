"use client";

import { useActionState, useState } from "react";
import { BorderedCard, Button, TextField } from "@/components/ui";
import type { EmployerActionState } from "@/lib/employer/actions";

export interface CampaignFormValues {
  name: string;
  jobPostingId: string;
  dailyRateNgn: number;
  totalBudgetNgn: number;
  endsOn: string | null;
  targetLocations: string[] | null;
}

export interface PromotableJob {
  id: string;
  title: string;
}

const naira = (n: number) => `₦${n.toLocaleString("en-NG")}`;

export function CampaignForm({
  action,
  jobs,
  initial,
  submitLabel,
  pendingLabel,
  walletBalanceNgn,
  jobLocked = false,
}: {
  action: (state: EmployerActionState, form: FormData) => Promise<EmployerActionState>;
  jobs: PromotableJob[];
  initial?: CampaignFormValues;
  submitLabel: string;
  pendingLabel: string;
  walletBalanceNgn: number;
  /** Editing: the promoted job can't be swapped after creation. */
  jobLocked?: boolean;
}) {
  const [state, formAction, pending] = useActionState<EmployerActionState, FormData>(action, null);
  const error = state && "error" in state ? state.error : null;
  const saved = state !== null && "ok" in state;

  // Mirrored into state purely to show the runtime below the fields. The
  // server re-validates both numbers — this is arithmetic for the reader, not
  // a check.
  const [daily, setDaily] = useState(initial?.dailyRateNgn ?? 0);
  const [total, setTotal] = useState(initial?.totalBudgetNgn ?? 0);
  const days = daily > 0 ? Math.floor(total / daily) : 0;

  if (jobs.length === 0 && !jobLocked) {
    return (
      <BorderedCard className="p-6">
        <p className="font-body text-[15px] leading-[1.6] text-ink">
          A campaign promotes one of your published jobs, and you don&apos;t have one yet. Post a
          job first, then come back here to promote it.
        </p>
      </BorderedCard>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {error && (
        <p className="border-[1.5px] border-rust bg-rust-soft px-3.5 py-2.5 text-[13.5px] text-rust">
          {error}
        </p>
      )}
      {saved && !error && (
        <p className="border-[1.5px] border-green px-3.5 py-2.5 text-[13.5px] text-ink">Saved.</p>
      )}

      <BorderedCard className="p-6">
        <form action={formAction} className="flex flex-col gap-5">
          <TextField
            label="Campaign name"
            name="name"
            required
            defaultValue={initial?.name}
            placeholder="e.g. Backend Engineer — Lagos push"
          />

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="jobPostingId"
              className="font-body text-[13px] font-semibold text-ink-soft"
            >
              Job to promote
            </label>
            {jobLocked ? (
              <>
                <input type="hidden" name="jobPostingId" value={initial?.jobPostingId ?? ""} />
                <p className="min-h-11 border-[1.5px] border-line bg-paper-alt px-3.5 py-2.5 font-body text-[15px] text-ink-soft">
                  {jobs.find((j) => j.id === initial?.jobPostingId)?.title ?? "—"}
                </p>
                <p className="font-body text-[12.5px] text-ink-soft">
                  Can&apos;t be changed after the campaign is created — spend is already recorded
                  against this job. Create a new campaign to promote a different one.
                </p>
              </>
            ) : (
              <select
                id="jobPostingId"
                name="jobPostingId"
                required
                defaultValue={initial?.jobPostingId ?? ""}
                className="min-h-11 border-[1.5px] border-ink bg-card px-3.5 py-2.5 font-body text-[15px] text-ink outline-none focus:border-rust"
              >
                <option value="">Choose a job</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="grid grid-cols-1 gap-5 min-[640px]:grid-cols-2">
            <TextField
              label="Daily budget (₦)"
              name="dailyRate"
              type="number"
              min={1}
              required
              defaultValue={initial?.dailyRateNgn}
              onChange={(e) => setDaily(Number(e.currentTarget.value) || 0)}
              placeholder="e.g. 2000"
            />
            <TextField
              label="Total budget (₦)"
              name="totalBudget"
              type="number"
              min={1}
              required
              defaultValue={initial?.totalBudgetNgn}
              onChange={(e) => setTotal(Number(e.currentTarget.value) || 0)}
              placeholder="e.g. 30000"
            />
          </div>

          {/*
            Stated in days because that is the unit the employer is actually
            buying — the campaign is charged once per day it runs, not per
            click. Saying so here, next to the numbers, is the honest place for
            it: it is the difference between "₦30,000 of advertising" and
            "fifteen days of advertising", and those are not the same promise.
          */}
          <p className="font-body text-[13px] text-ink-soft">
            {days > 0 ? (
              <>
                At {naira(daily)} a day, this budget runs for <strong>{days} days</strong>. You are
                charged once for each day the campaign is live — not per click. Your ad wallet holds{" "}
                {naira(walletBalanceNgn)}.
              </>
            ) : (
              <>
                Campaigns are charged once for each day they run — not per click. Your ad wallet
                holds {naira(walletBalanceNgn)}.
              </>
            )}
          </p>

          <div className="grid grid-cols-1 gap-5 min-[640px]:grid-cols-2">
            <TextField
              label="End date (optional)"
              name="endsOn"
              type="date"
              defaultValue={initial?.endsOn ?? undefined}
            />
            <TextField
              label="Target locations (optional)"
              name="targetLocations"
              defaultValue={initial?.targetLocations?.join(", ")}
              placeholder="Lagos, Abuja"
            />
          </div>

          <div>
            <Button type="submit" disabled={pending}>
              {pending ? pendingLabel : submitLabel}
            </Button>
          </div>
        </form>
      </BorderedCard>
    </div>
  );
}
