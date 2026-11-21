-- Rollback of 0283: the three event categories default to false again for new rows, as 0265 created them. Rows created while 0283 was in place keep the values they were given; no stored row is changed here.
alter table public.email_preferences
  alter column push_new_applicant set default false,
  alter column push_application_viewed set default false,
  alter column push_match_alert set default false;
