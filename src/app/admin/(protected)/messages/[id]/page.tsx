import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/admin/require-admin";
import { getMessagingService, type AdminActor } from "@/lib/admin/messages";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { QueueHeader } from "@/components/admin/queue-chrome";
import { MessageDetailView } from "@/components/admin/messages/message-views";
import { SWITCHED_OFF_NOTICE } from "@/components/admin/messages/texts";
import { Container } from "@/components/ui";
import { cancelAction, continueEmailAction, prepareAction, resumeAction, sendAction, submitAction, approveAction, testSendAction } from "../actions";
import { readOutcomeCounts } from "../outcomes";

export const metadata = { title: "Message — Talentrah admin", robots: { index: false, follow: false } };

export default async function MessagePage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requirePermission("user_messaging");
  const { id } = await params;
  const actor: AdminActor = { adminId: admin.adminId, permissions: admin.permissions };
  const service = getMessagingService();
  const switches = await service.switches(actor);

  const header = <QueueHeader eyebrow="User messages" title="One message." blurb="Counts only: this page never lists the people a message goes to." adminLabel={admin.displayName || admin.email} />;
  if (!switches.sendPathOpen) {
    return (
      <Container className="flex max-w-[900px] flex-col gap-8 py-12">
        {header}
        <p data-testid="switched-off" className="border-[1.5px] border-ink bg-card px-4 py-3 text-[15px]">{SWITCHED_OFF_NOTICE}</p>
        <Link href="/admin/messages" className="text-[14px] text-rust">Back to messages</Link>
      </Container>
    );
  }

  const message = await service.get(actor, id);
  if (!message) notFound();
  const [counts, limits, events, outcomes] = await Promise.all([
    service.channelCounts(actor, id),
    service.limits(actor),
    service.audit(actor, id),
    readOutcomeCounts(createServiceRoleClient(), id),
  ]);

  return (
    <Container className="flex max-w-[900px] flex-col gap-8 py-12">
      {header}
      <MessageDetailView
        message={message}
        counts={counts}
        outcomes={outcomes}
        limits={limits}
        switches={switches}
        events={events}
        actions={{ prepare: prepareAction, testSend: testSendAction, submit: submitAction, approve: approveAction, cancel: cancelAction, send: sendAction, continueEmail: continueEmailAction, resume: resumeAction }}
      />
      <Link href="/admin/messages" className="text-[14px] text-rust">Back to messages</Link>
    </Container>
  );
}
