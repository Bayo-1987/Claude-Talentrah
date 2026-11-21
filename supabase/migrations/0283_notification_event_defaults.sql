-- 0283: people who have not chosen are told about the three event categories by default.
--
-- email_preferences.push_new_applicant, push_application_viewed and push_match_alert were created (0265) with a default of false, so every new account started with all three off and had to find the
-- screen to hear about anything. They now default to true for NEW rows. Nothing else changes:
--   * push_enabled (the master push switch) stays false: a device needs the browser's permission, so it is turned on by a tap on that device, never by a default;
--   * push_promotions and email_promotions stay false (consent is never a default); email_announcements stays true;
--   * a push still reaches a device only when push_enabled is true AND the event switch is true AND a device is registered, so these defaults send nothing by themselves.
-- Changing a column default rewrites no stored row: every existing row keeps exactly the values it has, including the old false ones. There is no data statement in this file, and a test asserts it.
alter table public.email_preferences
  alter column push_new_applicant set default true,
  alter column push_application_viewed set default true,
  alter column push_match_alert set default true;
