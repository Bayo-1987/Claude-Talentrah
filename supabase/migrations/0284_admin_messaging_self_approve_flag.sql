-- 0284: the flag admin_messaging_self_approve, OFF.
--
-- It will let one operator send an admin message without a second approver, in a later, code-only change. This file only seeds the switch: one row, off. A row that already exists (the owner's) is left exactly as
-- it is, and a missing row means off, as for every other flag. Nothing reads this flag yet, and it is deliberately not part of the flag_state bitmask or of any check that stops a send from starting.
-- It does not depend on 0283 or on any other migration beyond the feature_flags table that 0265 and earlier created.
insert into public.feature_flags (key, label, enabled) values
  ('admin_messaging_self_approve', 'Admin messages: send without a second approver', false)
on conflict (key) do nothing;
