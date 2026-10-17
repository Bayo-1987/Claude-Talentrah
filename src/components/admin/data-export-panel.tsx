"use client";

import { useState } from "react";
import { Button, BorderedCard, EyebrowLabel, SelectField, TextField } from "@/components/ui";
import { REASON_CODES, REQUESTER_CHECKS } from "@/lib/data-export/constants";

const REASON_LABELS: Record<(typeof REASON_CODES)[number], string> = {
  access_request: "The person asked for a copy of their data",
  portability_request: "The person asked to take their data elsewhere",
  account_support: "A support case needs it",
};
const CHECK_LABELS: Record<(typeof REQUESTER_CHECKS)[number], string> = {
  contact_form: "Asked through the signed-in contact form",
  registered_address_reply: "Replied from the address on the account",
};

type Answer = { ok: boolean; message: string };

/**
 * Produces a person's data export, or cancels one nobody has opened. Shown under the person's record, ONLY to an operator who holds `data_export` (the page decides; the route checks again).
 *
 * There is no user-facing version of this anywhere. Starting an export emails the account owner first, then generates the file, then emails them a link that works once, only while they are signed in
 * as this account, for 72 hours. Everything typed here goes into a log kept for three years: the ticket is a reference (letters, digits, dot, dash), the reason and the check are pick-lists.
 */
export function DataExportPanel({ personId }: { personId: string }) {
  const [ticket, setTicket] = useState("");
  const [reason, setReason] = useState("");
  const [check, setCheck] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);

  async function send(action: "start" | "cancel") {
    setBusy(true);
    setAnswer(null);
    try {
      const res = await fetch("/admin/data-export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, target: personId, ticket, reason, requesterCheck: check }),
      });
      const json = (await res.json().catch(() => null)) as Answer | null;
      setAnswer(json ?? { ok: false, message: "No answer came back. Nothing is known to have happened; check before trying again." });
    } catch {
      setAnswer({ ok: false, message: "The request did not reach the server. Nothing is known to have happened; check before trying again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <EyebrowLabel>Data export</EyebrowLabel>
      <BorderedCard className="flex flex-col gap-4 p-5">
        <p className="text-[14px] text-ink-soft">
          Produce a copy of this person&apos;s data for a support case. <strong className="text-ink">They are emailed first</strong>, then emailed a link that works once, only while they are signed in
          as this account, for 72 hours. You never see the file. Every step is recorded against your account.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField id="export-ticket" label="Support ticket reference" name="ticket" autoComplete="off" value={ticket} onChange={(e) => setTicket(e.target.value)} placeholder="SUP-1234" />
          <SelectField
            id="export-reason"
            label="Why"
            name="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            options={REASON_CODES.map((c) => ({ value: c, label: REASON_LABELS[c] }))}
          />
          <SelectField
            id="export-check"
            label="How the requester was checked"
            name="requesterCheck"
            value={check}
            onChange={(e) => setCheck(e.target.value)}
            options={REQUESTER_CHECKS.map((c) => ({ value: c, label: CHECK_LABELS[c] }))}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" disabled={busy} onClick={() => send("start")}>
            {busy ? "Working…" : "Start the export"}
          </Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => send("cancel")}>
            Cancel an unused export
          </Button>
        </div>
        <p className="font-display text-[13.5px] italic text-ink-soft">
          Cancelling needs only the ticket reference. It deletes a file nobody has opened and frees the next start; it does not email the person.
        </p>
        {answer && (
          <p role="status" className={"border-[1.5px] px-3.5 py-2.5 text-[14px] " + (answer.ok ? "border-ink bg-card" : "border-rust bg-rust-soft text-rust")}>
            {answer.message}
          </p>
        )}
      </BorderedCard>
    </section>
  );
}
