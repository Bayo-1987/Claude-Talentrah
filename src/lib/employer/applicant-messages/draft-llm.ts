import "server-only";
import { generateWithFailover } from "@/lib/llm";
import { FARAH_SYSTEM_PROMPT } from "@/lib/farah/system-prompt";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { employerHasPremium } from "@/lib/employer/premium";
import { buildDraftPrompt, type DraftDeps, type DraftPromptInput } from "./draft-core";

const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string", description: "One line, under 120 characters." },
    body: { type: "string", description: "The message body: plain text, under 180 words, no markdown." },
  },
  required: ["subject", "body"],
} as const;

async function generateMessageDraft(input: DraftPromptInput): Promise<{ subject: string; body: string }> {
  const raw = await generateWithFailover((provider) =>
    provider.generateText({
      systemPrompt: FARAH_SYSTEM_PROMPT,
      turns: [{ role: "user", content: buildDraftPrompt(input) }],
      maxOutputTokens: 900,
      jsonSchema: DRAFT_SCHEMA as unknown as Record<string, unknown>,
    }),
  );
  const parsed = JSON.parse(raw) as { subject?: unknown; body?: unknown };
  if (typeof parsed.subject !== "string" || typeof parsed.body !== "string") throw new Error("unparsable draft");
  return { subject: parsed.subject, body: parsed.body };
}

/**
 * The real dependencies of runFarahMessageDraft: Premium from organization_premium, the EMPLOYER's ad wallet through debit_ad_wallet / credit_ad_wallet (service role only: their organization_id
 * argument would otherwise be a forgeable authorisation; the caller passes the organisation its own session resolved), and the shared model failover.
 */
export function defaultDraftDeps(): DraftDeps {
  const admin = createServiceRoleClient();
  return {
    hasPremium: employerHasPremium,
    async debit({ organizationId, userId, amountNgn }) {
      const { data, error } = await admin.rpc("debit_ad_wallet", {
        p_organization_id: organizationId,
        p_amount_ngn: amountNgn,
        p_reason: "farah_message_draft_charge",
        p_actor_user_id: userId,
      });
      if (error) return { ok: false, failed: true };
      return { ok: !!data?.[0]?.ok, failed: false };
    },
    async credit({ organizationId, userId, amountNgn }) {
      const { error } = await admin.rpc("credit_ad_wallet", {
        p_organization_id: organizationId,
        p_amount_ngn: amountNgn,
        p_reason: "reversal",
        p_actor_user_id: userId,
      });
      return { failed: !!error };
    },
    generate: generateMessageDraft,
  };
}
