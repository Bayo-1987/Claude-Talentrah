"use client";

import { ActionForm, type MessageAction } from "./action-form";
import type { NotificationSettingKey } from "@/lib/notifications/contract";

export function LimitForm({ settingKey, label, value, action }: { settingKey: NotificationSettingKey; label: string; value: number; action: MessageAction }) {
  return (
    <ActionForm action={action} targetId={settingKey} hidden={{ key: settingKey }} label="Save" pendingLabel="Saving…" variant="secondary">
      <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-soft">
        {label}
        <input name="value" type="number" min={0} max={10000} step={1} defaultValue={value} className="min-h-11 w-40 border-[1.5px] border-ink bg-card px-3.5 py-2.5 text-[15px] text-ink" />
      </label>
    </ActionForm>
  );
}
