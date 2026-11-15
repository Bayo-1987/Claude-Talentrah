import Link from "next/link";
import { requirePermission } from "@/lib/admin/require-admin";
import { getMessagingService } from "@/lib/admin/messages";
import { QueueHeader } from "@/components/admin/queue-chrome";
import { ComposeForm } from "@/components/admin/messages/compose-form";
import { SWITCHED_OFF_NOTICE } from "@/components/admin/messages/texts";
import { Container } from "@/components/ui";
import { composeAction } from "../actions";

export const metadata = { title: "New message — Talentrah admin", robots: { index: false, follow: false } };

export default async function NewMessagePage() {
  const admin = await requirePermission("user_messaging");
  const switches = await getMessagingService().switches({ adminId: admin.adminId, permissions: admin.permissions });
  return (
    <Container className="flex max-w-[900px] flex-col gap-8 py-12">
      <QueueHeader eyebrow="User messages" title="New message." blurb="Save it as a draft first. Nothing reaches anyone until it is prepared, approved by someone else, and sent." adminLabel={admin.displayName || admin.email} />
      {switches.sendPathOpen ? (
        <ComposeForm action={composeAction} promotionsOn={switches.promotionsOn} emailOn={switches.emailOn} />
      ) : (
        <p data-testid="switched-off" className="border-[1.5px] border-ink bg-card px-4 py-3 text-[15px]">{SWITCHED_OFF_NOTICE}</p>
      )}
      <Link href="/admin/messages" className="text-[14px] text-rust">Back to messages</Link>
    </Container>
  );
}
