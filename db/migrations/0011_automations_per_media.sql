-- Preserve automation IDs and historical execution/follow-up references.
alter table app_private.automations
  drop constraint automations_account_id_unique,
  drop constraint automations_connection_id_unique,
  add constraint automations_connection_media_unique unique (connection_id, media_id);
