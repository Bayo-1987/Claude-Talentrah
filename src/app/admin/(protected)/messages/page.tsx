import Link from "next/link";
import { requirePermission } from "@/lib/admin/require-admin";
import { getMessagingService, type AdminActor } from "@/lib/admin/messages";
import { QueueHeader } from "@/components/admin/queue-chrome";
import { MessagesIndexView } from "@/components/admin/messages/message-views";
import { buttonClasses, Container } from "@/components/ui";
import { resolveClaimAction, setLimitAction } from "./actions";

export const metadata = { title: "User messages — Talentrah admin", robots: { index: false, follow: false } };

/**
 * User messages. The guard is the first line, and every Server Action in ./actions.ts repeats it. With admin messaging switched off the page says so and reads nothing.
 */
export default async function MessagesPage() {
  const admin = await requirePermission("user_messaging");
  const actor: AdminActor = { adminId: admin.adminId, permissions: admin.permissions };
  const service = getMessagingService();
  const switches = await service.switches(actor);

  let view;
  if (!switches.sendPathOpen) {
    view = (
      <MessagesIndexView switches={switches} messages={[]} limits={{ cap24h: 0, ceilingMonth: 0, sentLast24h: 0, sentThisMonth: 0 }} queued={0} canEditLimits={false} staleClaims={[]} setLimit={setLimitAction} resolveClaim={resolveClaimAction} />
    );
  } else {
    const [messages, limits, staleClaims] = await Promise.all([service.list(actor), service.limits(actor), service.staleEmailClaims(actor)]);
    let queued = 0;
    for (const m of messages.filter((x) => x.status === "sending" || x.status === "paused_email_cap" || x.status === "paused_email_ceiling")) {
      queued += (await service.channelCounts(actor, m.id)).queuedEmail;
    }
    view = (
      <MessagesIndexView switches={switches} messages={messages} limits={limits} queued={queued} canEditLimits={admin.permissions.includes("operators")} staleClaims={staleClaims} setLimit={setLimitAction} resolveClaim={resolveClaimAction} />
    );
  }

  return (
    <Container className="flex max-w-[900px] flex-col gap-8 py-12">
      <QueueHeader
        eyebrow="User messages"
        title="Write to people."
        blurb="Announcements and promotions to the app, to phones and to email. Every message is prepared, approved by a second person, and sent from here."
        adminLabel={admin.displayName || admin.email}
      />
      {switches.sendPathOpen && (
        <div><Link href="/admin/messages/new" className={buttonClasses("secondary", "sm")}>New message</Link></div>
      )}
      {view}
    </Container>
  );
}
