import Link from "next/link";
import { BorderedCard, EyebrowLabel } from "@/components/ui";
import type { AdminMessageEventRow, AdminMessageRow, StaleClaimRow } from "@/lib/notifications/contract";
import type { ChannelCounts, EmailLimits } from "@/lib/admin/messages/reads";
import type { Switches } from "@/lib/admin/messages/service";
import { ActionForm, type MessageAction } from "./action-form";
import { ApprovePanel } from "./approve-panel";
import { LimitsPanel } from "./limits-panel";
import { StaleClaimsPanel } from "./stale-claims-panel";
import { SelfSendNotice } from "./self-send-notice";
import { isSelfApproved } from "@/lib/admin/messages/self-send";
import { OUTCOME_LABEL, type OutcomeCounts } from "./outcome-counts";
import { COUNTS_ONLY_NOTE, KIND_LABEL, QUIET_HOURS_SENTENCE, STATUS_LABEL, SWITCHED_OFF_NOTICE, pausedSentence, switchedOffReason } from "./texts";

export type MessageActions = {
  prepare: MessageAction;
  testSend: MessageAction;
  submit: MessageAction;
  approve: MessageAction;
  cancel: MessageAction;
  send: MessageAction;
  continueEmail: MessageAction;
  resume: MessageAction;
};

/** The reason a message's send path is closed right now, or null when it is open. Admin messaging gates everything; promotions and email gate only what uses them. */
export function closedReason(switches: Switches, message: Pick<AdminMessageRow, "kind" | "channels">): string | null {
  if (!switches.sendPathOpen) return SWITCHED_OFF_NOTICE;
  if (message.kind === "promotion" && !switches.promotionsOn) return switchedOffReason("promotions");
  if (message.channels.includes("email") && !switches.emailOn) return switchedOffReason("email");
  return null;
}

export function MessagesIndexView(props: {
  switches: Switches;
  messages: AdminMessageRow[];
  limits: EmailLimits;
  queued: number;
  canEditLimits: boolean;
  staleClaims: StaleClaimRow[];
  setLimit: MessageAction;
  resolveClaim: MessageAction;
}) {
  const { switches } = props;
  if (!switches.sendPathOpen) {
    return (
      <BorderedCard className="flex flex-col gap-2 p-5">
        <EyebrowLabel>Switched off</EyebrowLabel>
        <p data-testid="switched-off" className="text-[15px]">{SWITCHED_OFF_NOTICE}</p>
      </BorderedCard>
    );
  }
  return (
    <div className="flex flex-col gap-8">
      <p className="text-[13.5px] text-ink-soft">{COUNTS_ONLY_NOTE}</p>
      <LimitsPanel limits={props.limits} queued={props.queued} canEdit={props.canEditLimits} setLimit={props.setLimit} />
      <StaleClaimsPanel claims={props.staleClaims} resolve={props.resolveClaim} />
      <ul className="flex list-none flex-col gap-3 p-0">
        {props.messages.map((m) => (
          <li key={m.id}>
            <BorderedCard className="flex flex-wrap items-baseline justify-between gap-3 p-4">
              <Link href={`/admin/messages/${m.id}`} className="font-display text-[18px] font-semibold hover:text-rust">{m.title}</Link>
              <span className="text-[13px] text-ink-soft">{KIND_LABEL[m.kind]} · {STATUS_LABEL[m.status]} · {m.audience_count} in the audience</span>
            </BorderedCard>
          </li>
        ))}
        {props.messages.length === 0 && <li className="font-display italic text-ink-soft">No messages yet.</li>}
      </ul>
    </div>
  );
}

function CountsBlock({ title, counts }: { title: string; counts: OutcomeCounts["push"] }) {
  const rows = (Object.keys(counts) as Array<keyof typeof counts>).filter((k) => counts[k] > 0);
  return (
    <div>
      <p className="text-[13px] font-semibold text-ink-soft">{title}</p>
      {rows.length === 0 ? <p className="text-[14px] text-ink-soft">Nothing yet.</p> : (
        <ul className="list-none p-0 text-[14.5px]">{rows.map((k) => <li key={k}>{OUTCOME_LABEL[k]}: {counts[k]}</li>)}</ul>
      )}
    </div>
  );
}

const CANCELLABLE = new Set(["draft", "prepared", "submitted", "approved", "paused_email_cap", "paused_email_ceiling"]);

export function MessageDetailView(props: {
  message: AdminMessageRow;
  counts: ChannelCounts;
  outcomes: OutcomeCounts;
  limits: EmailLimits;
  switches: Switches;
  events: AdminMessageEventRow[];
  actions: MessageActions;
}) {
  const { message: m, counts, outcomes, limits, switches, actions } = props;
  const closed = closedReason(switches, m);
  const paused = pausedSentence(m.status, limits);
  const hasEmail = m.channels.includes("email");
  const startable = m.status === "approved" || (m.status === "prepared" && !m.requires_approval);
  const id = m.id;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <p data-testid="kind-label" className="font-display text-[15px] font-semibold text-rust">{KIND_LABEL[m.kind]}</p>
        <p className="text-[13px] text-ink-soft">{STATUS_LABEL[m.status]}</p>
      </div>

      <BorderedCard className="flex flex-col gap-2 p-5">
        <EyebrowLabel>What people will see</EyebrowLabel>
        <h2 className="font-display text-[22px] font-semibold">{m.title}</h2>
        <p className="whitespace-pre-wrap text-[15px]">{m.body}</p>
        {m.link_path && <p className="text-[13.5px] text-ink-soft">Link on this site: {m.link_path}</p>}
        {m.consent_line && <p className="text-[13.5px] text-ink-soft">Consent line: {m.consent_line}</p>}
        {m.channels.includes("push") && <p data-testid="quiet-hours" className="text-[13px] text-ink-soft">{QUIET_HOURS_SENTENCE}</p>}
      </BorderedCard>

      <BorderedCard className="flex flex-col gap-3 p-5">
        <EyebrowLabel>Counts</EyebrowLabel>
        <p className="text-[15px]">Audience: {m.audience_count}. Sent {m.sent_count}, failed {m.failed_count}, skipped {m.skipped_count}.</p>
        <p className="text-[14px] text-ink-soft">In the app {counts.inapp} · push {counts.push} · email {counts.email} ({counts.queuedEmail} still queued)</p>
        <div className="grid gap-6 sm:grid-cols-2">
          {m.channels.includes("push") && <CountsBlock title="Push, by result" counts={outcomes.push} />}
          {hasEmail && <CountsBlock title="Email, by result" counts={outcomes.email} />}
        </div>
        <p className="text-[13px] text-ink-soft">{COUNTS_ONLY_NOTE}</p>
      </BorderedCard>

      {paused && <p data-testid="paused" role="status" className="border-[1.5px] border-rust bg-rust-soft px-4 py-3 text-[15px] text-rust">{paused}</p>}

      {closed ? (
        <p data-testid="closed" className="border-[1.5px] border-ink bg-card px-4 py-3 text-[15px]">{closed}</p>
      ) : (
        <div className="flex flex-col gap-5">
          {m.status === "draft" && <ActionForm action={actions.prepare} targetId={id} hidden={{ id }} label="Prepare (freeze the audience)" />}
          {(m.status === "prepared" || m.status === "approved") && hasEmail && (
            <ActionForm action={actions.testSend} targetId={`${id}-test`} hidden={{ id }} label="Send a test to myself" variant="secondary" />
          )}
          {m.status === "prepared" && m.requires_approval && <ActionForm action={actions.submit} targetId={id} hidden={{ id }} label="Submit for approval" />}
          {m.status === "submitted" && <ApprovePanel messageId={id} kind={m.kind} action={actions.approve} />}
          {startable && (
            <ActionForm action={actions.send} targetId={id} hidden={{ id }} label="Send" pendingLabel="Sending…">
              {isSelfApproved(m) && <SelfSendNotice message={m} />}
            </ActionForm>
          )}
          {m.status === "sending" && hasEmail && counts.queuedEmail > 0 && <ActionForm action={actions.continueEmail} targetId={id} hidden={{ id }} label="Continue sending" pendingLabel="Sending…" />}
          {(m.status === "paused_email_cap" || m.status === "paused_email_ceiling") && <ActionForm action={actions.resume} targetId={id} hidden={{ id }} label="Resume" />}
          {CANCELLABLE.has(m.status) && <ActionForm action={actions.cancel} targetId={`${id}-cancel`} hidden={{ id }} label="Cancel this message" variant="ghost" />}
        </div>
      )}

      <BorderedCard className="flex flex-col gap-2 p-5">
        <EyebrowLabel>History</EyebrowLabel>
        <ul className="list-none p-0 text-[13.5px]">
          {props.events.map((e) => <li key={e.id}>{e.at.slice(0, 16).replace("T", " ")} UTC · {e.event.replace(/_/g, " ")}{e.actor_email ? ` · ${e.actor_email}` : ""}</li>)}
        </ul>
      </BorderedCard>
    </div>
  );
}
