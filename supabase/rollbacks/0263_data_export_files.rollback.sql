-- Rollback for 0263: the functions and the table.
--
-- THE BUCKET IS NOT DROPPED HERE, and that is Supabase's rule rather than an omission: storage.protect_delete() refuses `delete from storage.objects` and
-- `delete from storage.buckets` ("Direct deletion from storage tables is not allowed. Use the Storage API instead", 42501). Before running this file, empty the bucket through the Storage
-- API (the hourly sweep does it for everything that is not live; or remove the objects by hand), and remove the empty `data-exports` bucket through the Storage API or the dashboard
-- afterwards. An empty private bucket with no policies holds and exposes nothing, so leaving it is harmless.
-- Anything exported and not yet downloaded is lost, which is how an expiring file is meant to end.
drop function if exists public.mark_data_export_object_deleted(uuid, uuid, text);
drop function if exists public.cancel_unused_data_export(uuid, uuid);
drop function if exists public.cancel_stale_data_exports();
drop function if exists public.finish_data_export_attempt(uuid, uuid, text);
drop function if exists public.swap_stale_data_export_attempt(uuid, uuid, uuid);
drop function if exists public.claim_data_export_download(uuid, uuid);
drop table if exists public.data_export_files;
